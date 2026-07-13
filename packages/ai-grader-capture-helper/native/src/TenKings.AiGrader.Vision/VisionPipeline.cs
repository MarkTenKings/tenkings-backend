using System.Runtime.InteropServices;
using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

internal sealed record QuadCandidate(Point2f[] Corners, string Source, double Residual);
internal sealed record EvaluatedCandidate(Point2f[] Corners, string Source, GeometryMetrics Metrics);

internal sealed class PreprocessedImages : IDisposable
{
    public required Rect SourceRoi { get; init; }
    public required double AnalysisScale { get; init; }
    public required Mat Gray { get; init; }
    public required Mat BrightMask { get; init; }
    public required Mat DarkMask { get; init; }
    public required Mat Edges { get; init; }
    public required Mat GradientX { get; init; }
    public required Mat GradientY { get; init; }

    // Buffers are owned and reused by the detector's serialized workspace.
    public void Dispose() { }
}

internal static class VisionPipeline
{
    public static PreprocessedImages Preprocess(Mono8Frame frame, DetectorOptions options, VisionWorkspace workspace)
    {
        CopyMono8(frame, workspace.Source);
        ApplyUndistortion(workspace.Source, frame.Calibration.Lens, workspace.Corrected);
        var roi = ToPixelRoi(frame.Calibration.SafeRoi, workspace.Corrected.Width, workspace.Corrected.Height);
        using var cropped = new Mat(workspace.Corrected, roi);
        var scale = Math.Min(1d, options.AnalysisMaxDimension / (double)Math.Max(cropped.Width, cropped.Height));
        if (scale < 0.999) Cv2.Resize(cropped, workspace.Gray, new Size(), scale, scale, InterpolationFlags.Area);
        else cropped.CopyTo(workspace.Gray);

        Cv2.GaussianBlur(workspace.Gray, workspace.Denoised, new Size(3, 3), 0.8);
        using (var clahe = Cv2.CreateCLAHE(2.0, new Size(8, 8)))
        {
            clahe.Apply(workspace.Denoised, workspace.Contrast);
        }

        Cv2.AdaptiveThreshold(workspace.Contrast, workspace.Bright, 255, AdaptiveThresholdTypes.GaussianC, ThresholdTypes.Binary, options.AdaptiveBlockSize, options.AdaptiveConstant);
        Cv2.AdaptiveThreshold(workspace.Contrast, workspace.Dark, 255, AdaptiveThresholdTypes.GaussianC, ThresholdTypes.BinaryInv, options.AdaptiveBlockSize, options.AdaptiveConstant);
        Cv2.Canny(workspace.Contrast, workspace.Canny, options.CannyLow, options.CannyHigh, 3, true);
        workspace.EnsureKernel(options.MorphologyKernel);
        Cv2.MorphologyEx(workspace.Bright, workspace.BrightClosed, MorphTypes.Close, workspace.MorphKernel, iterations: 1);
        Cv2.MorphologyEx(workspace.Dark, workspace.DarkClosed, MorphTypes.Close, workspace.MorphKernel, iterations: 1);
        Cv2.MorphologyEx(workspace.Canny, workspace.EdgesClosed, MorphTypes.Close, workspace.MorphKernel, iterations: 2);
        Cv2.Sobel(workspace.Contrast, workspace.GradientX, MatType.CV_32FC1, 1, 0, 3);
        Cv2.Sobel(workspace.Contrast, workspace.GradientY, MatType.CV_32FC1, 0, 1, 3);
        return new PreprocessedImages
        {
            SourceRoi = roi,
            AnalysisScale = scale,
            Gray = workspace.Gray,
            BrightMask = workspace.BrightClosed,
            DarkMask = workspace.DarkClosed,
            Edges = workspace.EdgesClosed,
            GradientX = workspace.GradientX,
            GradientY = workspace.GradientY,
        };
    }

    public static IReadOnlyList<QuadCandidate> FindCandidates(PreprocessedImages images, DetectorOptions options)
    {
        var candidates = new List<QuadCandidate>();
        if (options.Mode is DetectorMode.PcaBaseline or DetectorMode.Fused) AddPca(images, candidates);
        if (options.Mode is DetectorMode.ContourQuad or DetectorMode.Fused)
        {
            AddContours(images.BrightMask, candidates);
            AddContours(images.DarkMask, candidates);
        }

        if (options.Mode is DetectorMode.LineRecovery or DetectorMode.Fused) LineRecovery.Add(images.Edges, candidates);
        return candidates;
    }

    public static EvaluatedCandidate? Evaluate(QuadCandidate candidate, PreprocessedImages images, DetectorOptions options)
    {
        var corners = VisionMath.OrderCorners(candidate.Corners);
        if (corners.Length != 4 || !VisionMath.IsConvex(corners)) return null;
        var evidence = new List<EdgeEvidence>(4);
        var lengths = new double[4];
        for (var index = 0; index < 4; index++)
        {
            var start = corners[index];
            var end = corners[(index + 1) % 4];
            lengths[index] = VisionMath.Distance(start, end);
            var sample = SampleEdge(start, end, images, candidate.Residual);
            evidence.Add(new EdgeEvidence(
                index, lengths[index], sample.Support, sample.Continuity,
                candidate.Residual, candidate.Residual * lengths[index], sample.Score));
        }

        var firstPair = Math.Max(1, (lengths[0] + lengths[2]) / 2);
        var secondPair = Math.Max(1, (lengths[1] + lengths[3]) / 2);
        var ratio = Math.Max(firstPair, secondPair) / Math.Min(firstPair, secondPair);
        var aspectScore = Math.Exp(-Math.Abs(Math.Log(ratio / options.ExpectedAspectRatio)) * 3.2);
        var coverage = Math.Abs(VisionMath.PolygonArea(corners)) / (images.Edges.Width * (double)images.Edges.Height);
        var coverageScore = Math.Exp(-Math.Abs(coverage - 0.48) / 0.38);
        var clearance = VisionMath.MinimumClearance(corners, images.Edges.Width, images.Edges.Height);
        var clearanceScore = Math.Clamp(clearance / 0.035, 0, 1);
        var perspective = Math.Max(
            Math.Abs(lengths[0] - lengths[2]) / Math.Max(lengths[0], lengths[2]),
            Math.Abs(lengths[1] - lengths[3]) / Math.Max(lengths[1], lengths[3]));
        var perspectiveScore = Math.Clamp(1 - (perspective / Math.Max(options.MaxPerspectiveSkew, 0.01)), 0, 1);
        var edgeSupport = evidence.Average(static edge => edge.GradientSupport);
        var continuity = evidence.Average(static edge => edge.Continuity);
        var residualScore = Math.Clamp(1 - candidate.Residual, 0, 1);
        var meanResidualPixels = evidence.Average(static edge => edge.ResidualPixels);
        var convexity = VisionMath.ConvexityScore(corners);
        var confidence = Math.Clamp(
            (edgeSupport * 0.26) + (continuity * 0.13) + (aspectScore * 0.14) +
            (coverageScore * 0.10) + (clearanceScore * 0.10) + (perspectiveScore * 0.12) +
            (residualScore * 0.08) + (convexity * 0.07), 0, 1);
        var metrics = new GeometryMetrics(
            confidence, ratio, aspectScore, coverage, coverageScore, clearance, clearanceScore,
            clearance >= options.MinClearanceFraction,
            perspective, perspectiveScore, convexity, residualScore, meanResidualPixels, edgeSupport, continuity,
            ReadOnly.Wrap(evidence));
        return new EvaluatedCandidate(corners, candidate.Source, metrics);
    }

    private static void AddContours(Mat mask, ICollection<QuadCandidate> candidates)
    {
        using var work = mask.Clone();
        Cv2.FindContours(work, out Point[][] contours, out _, RetrievalModes.External, ContourApproximationModes.ApproxSimple);
        var imageArea = mask.Width * (double)mask.Height;
        foreach (var contour in contours.OrderByDescending(static contour => Cv2.ContourArea(contour)).Take(12))
        {
            var area = Math.Abs(Cv2.ContourArea(contour));
            if (area < imageArea * 0.06 || area > imageArea * 0.94) continue;
            var hull = Cv2.ConvexHull(contour);
            var perimeter = Cv2.ArcLength(hull, true);
            var approx = Cv2.ApproxPolyDP(hull, perimeter * 0.018, true);
            if (approx.Length != 4 || !Cv2.IsContourConvex(approx)) continue;
            var corners = approx.Select(static point => new Point2f(point.X, point.Y)).ToArray();
            candidates.Add(new QuadCandidate(corners, "contour_quad", VisionMath.ContourResidual(hull, corners)));
        }
    }

    private static void AddPca(PreprocessedImages images, ICollection<QuadCandidate> candidates)
    {
        var contour = LargestPlausible(images.BrightMask) ?? LargestPlausible(images.DarkMask);
        if (contour is null) return;
        var meanX = contour.Average(static point => point.X);
        var meanY = contour.Average(static point => point.Y);
        double xx = 0, xy = 0, yy = 0;
        foreach (var point in contour)
        {
            var dx = point.X - meanX;
            var dy = point.Y - meanY;
            xx += dx * dx;
            xy += dx * dy;
            yy += dy * dy;
        }

        var angle = 0.5 * Math.Atan2(2 * xy, xx - yy);
        var axisX = new Point2f((float)Math.Cos(angle), (float)Math.Sin(angle));
        var axisY = new Point2f(-axisX.Y, axisX.X);
        var projected = contour.Select(point =>
        {
            var dx = point.X - meanX;
            var dy = point.Y - meanY;
            return (X: (dx * axisX.X) + (dy * axisX.Y), Y: (dx * axisY.X) + (dy * axisY.Y));
        }).ToArray();
        var minX = projected.Min(static point => point.X);
        var maxX = projected.Max(static point => point.X);
        var minY = projected.Min(static point => point.Y);
        var maxY = projected.Max(static point => point.Y);
        if (maxX - minX < 20 || maxY - minY < 20) return;
        Point2f Transform(double x, double y) => new(
            (float)(meanX + (x * axisX.X) + (y * axisY.X)),
            (float)(meanY + (x * axisX.Y) + (y * axisY.Y)));
        candidates.Add(new QuadCandidate(new[]
        {
            Transform(minX, minY), Transform(maxX, minY), Transform(maxX, maxY), Transform(minX, maxY),
        }, "pca_baseline", 0.18));
    }

    private static Point[]? LargestPlausible(Mat mask)
    {
        using var work = mask.Clone();
        Cv2.FindContours(work, out Point[][] contours, out _, RetrievalModes.External, ContourApproximationModes.ApproxSimple);
        var imageArea = mask.Width * (double)mask.Height;
        return contours.Where(contour =>
        {
            var area = Math.Abs(Cv2.ContourArea(contour));
            return area >= imageArea * 0.06 && area <= imageArea * 0.94;
        }).OrderByDescending(static contour => Cv2.ContourArea(contour)).FirstOrDefault();
    }

    private static EdgeSample SampleEdge(Point2f start, Point2f end, PreprocessedImages images, double residual)
    {
        var samples = Math.Clamp((int)Math.Round(VisionMath.Distance(start, end)), 32, 240);
        var supportCount = 0;
        var continuityCount = 0;
        var nx = -(end.Y - start.Y);
        var ny = end.X - start.X;
        var normalLength = Math.Max(1e-6, Math.Sqrt((nx * nx) + (ny * ny)));
        nx /= (float)normalLength;
        ny /= (float)normalLength;
        for (var index = 0; index < samples; index++)
        {
            var amount = (index + 0.5) / samples;
            var x = (int)Math.Round(start.X + ((end.X - start.X) * amount));
            var y = (int)Math.Round(start.Y + ((end.Y - start.Y) * amount));
            if (x < 2 || y < 2 || x >= images.Edges.Width - 2 || y >= images.Edges.Height - 2) continue;
            var supported = false;
            var continuous = false;
            for (var oy = -2; oy <= 2; oy++)
            {
                for (var ox = -2; ox <= 2; ox++)
                {
                    var gx = images.GradientX.At<float>(y + oy, x + ox);
                    var gy = images.GradientY.At<float>(y + oy, x + ox);
                    var magnitude = Math.Sqrt((gx * gx) + (gy * gy));
                    if (magnitude > 24)
                    {
                        supported |= Math.Abs(((gx * nx) + (gy * ny)) / magnitude) >= 0.25;
                    }

                    continuous |= images.Edges.At<byte>(y + oy, x + ox) > 0;
                }
            }

            supportCount += supported ? 1 : 0;
            continuityCount += continuous ? 1 : 0;
        }

        var support = supportCount / (double)samples;
        var continuity = continuityCount / (double)samples;
        return new EdgeSample(support, continuity, Math.Clamp((support * 0.58) + (continuity * 0.32) + ((1 - residual) * 0.10), 0, 1));
    }

    private static void CopyMono8(Mono8Frame frame, Mat result)
    {
        result.Create(frame.Height, frame.Width, MatType.CV_8UC1);
        byte[] bytes;
        int offset;
        if (MemoryMarshal.TryGetArray(frame.Buffer, out ArraySegment<byte> segment) && segment.Array is not null)
        {
            bytes = segment.Array;
            offset = segment.Offset;
        }
        else
        {
            bytes = frame.Buffer.ToArray();
            offset = 0;
        }

        if (frame.Stride == frame.Width) Marshal.Copy(bytes, offset, result.Data, checked(frame.Width * frame.Height));
        else
        {
            var step = checked((int)result.Step());
            for (var row = 0; row < frame.Height; row++)
            {
                Marshal.Copy(bytes, offset + (row * frame.Stride), IntPtr.Add(result.Data, row * step), frame.Width);
            }
        }
    }

    private static void ApplyUndistortion(Mat source, LensCalibration? lens, Mat corrected)
    {
        if (lens is null)
        {
            source.CopyTo(corrected);
            return;
        }
        using var camera = new Mat(3, 3, MatType.CV_64FC1);
        using var distortion = new Mat(1, lens.DistortionCoefficients.Count, MatType.CV_64FC1);
        for (var row = 0; row < 3; row++)
        for (var column = 0; column < 3; column++)
            camera.Set(row, column, lens.CameraMatrix[(row * 3) + column]);
        for (var index = 0; index < lens.DistortionCoefficients.Count; index++)
            distortion.Set(0, index, lens.DistortionCoefficients[index]);
        Cv2.Undistort(source, corrected, camera, distortion);
    }

    private static Rect ToPixelRoi(NormalizedRoi roi, int width, int height)
    {
        var x = Math.Clamp((int)Math.Floor(roi.X * width), 0, width - 1);
        var y = Math.Clamp((int)Math.Floor(roi.Y * height), 0, height - 1);
        var right = Math.Clamp((int)Math.Ceiling((roi.X + roi.Width) * width), x + 1, width);
        var bottom = Math.Clamp((int)Math.Ceiling((roi.Y + roi.Height) * height), y + 1, height);
        return new Rect(x, y, right - x, bottom - y);
    }

    private readonly record struct EdgeSample(double Support, double Continuity, double Score);
}
