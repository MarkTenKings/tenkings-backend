using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

internal static class LineRecovery
{
    public static void Add(Mat edges, ICollection<QuadCandidate> candidates)
    {
        var minimum = Math.Max(24, Math.Min(edges.Width, edges.Height) * 0.06);
        var segments = Cv2.HoughLinesP(edges, 1, Math.PI / 180, 24, minimum, 36)
            .Select(line => new Segment(line.P1, line.P2))
            .Where(segment => segment.Length >= minimum)
            .OrderByDescending(static segment => segment.Length)
            .Take(160)
            .ToArray();
        if (segments.Length < 4) return;

        foreach (var dominant in CandidateOrientations(segments))
        {
            var perpendicular = NormalizeAngle(dominant + (Math.PI / 2));
            var first = segments.Where(segment => AngularDistance(segment.Angle, dominant) < Math.PI / 10).ToArray();
            var second = segments.Where(segment => AngularDistance(segment.Angle, perpendicular) < Math.PI / 9).ToArray();
            if (!TryFitOuterPair(first, dominant, out var firstLow, out var firstHigh) ||
                !TryFitOuterPair(second, perpendicular, out var secondLow, out var secondHigh)) continue;

            var intersections = new[]
            {
                Intersect(firstLow, secondLow),
                Intersect(firstHigh, secondLow),
                Intersect(firstHigh, secondHigh),
                Intersect(firstLow, secondHigh),
            };
            if (intersections.Any(static point => point is null)) continue;
            var corners = intersections.Cast<Point2f>().ToArray();
            var marginX = edges.Width * 0.12;
            var marginY = edges.Height * 0.12;
            if (corners.Any(point => point.X < -marginX || point.Y < -marginY || point.X > edges.Width + marginX || point.Y > edges.Height + marginY)) continue;
            var residual = Math.Clamp((firstLow.Residual + firstHigh.Residual + secondLow.Residual + secondHigh.Residual) / 4, 0, 1);
            candidates.Add(new QuadCandidate(corners, "line_recovery", residual));
            return;
        }
    }

    private static bool TryFitOuterPair(Segment[] segments, double angle, out ParametricLine low, out ParametricLine high)
    {
        low = default;
        high = default;
        if (segments.Length < 2) return false;
        var normal = new Point2f((float)-Math.Sin(angle), (float)Math.Cos(angle));
        var projected = segments.Select(segment => (Segment: segment, Projection: Dot(segment.Midpoint, normal)))
            .OrderBy(static item => item.Projection).ToArray();
        var groupSize = Math.Clamp(projected.Length / 3, 1, 12);
        low = FitLine(projected.Take(groupSize).Select(static item => item.Segment).ToArray());
        high = FitLine(projected.TakeLast(groupSize).Select(static item => item.Segment).ToArray());
        var separation = Math.Abs(Dot(high.Point, normal) - Dot(low.Point, normal));
        return separation > 30 && low.Direction != default && high.Direction != default &&
            AngularDistance(Math.Atan2(low.Direction.Y, low.Direction.X), Math.Atan2(high.Direction.Y, high.Direction.X)) < Math.PI / 18;
    }

    private static ParametricLine FitLine(IReadOnlyList<Segment> segments)
    {
        if (segments.Count == 0) return default;
        var points = segments.SelectMany(static segment => new[] { segment.P1, segment.Midpoint, segment.P2 }).ToArray();
        var first = Cv2.FitLine(points, DistanceTypes.Huber, 0, 0.01, 0.01);
        var firstPoint = new Point2f((float)first.X1, (float)first.Y1);
        var firstDirection = Normalize(new Point2f((float)first.Vx, (float)first.Vy));
        var firstNormal = new Point2f(-firstDirection.Y, firstDirection.X);
        var residuals = points.Select(point => DistanceToLine(point, firstPoint, firstNormal)).OrderBy(static value => value).ToArray();
        var median = Median(residuals);
        var deviations = residuals.Select(value => Math.Abs(value - median)).OrderBy(static value => value).ToArray();
        var robustSigma = Math.Max(0.35, Median(deviations) * 1.4826);
        var cutoff = Math.Max(1.5, median + (2.8 * robustSigma));
        var inliers = points.Where(point => DistanceToLine(point, firstPoint, firstNormal) <= cutoff).ToArray();
        if (inliers.Length < 3) return default;

        var fitted = Cv2.FitLine(inliers, DistanceTypes.Huber, 0, 0.01, 0.01);
        var pointOnLine = new Point2f((float)fitted.X1, (float)fitted.Y1);
        var direction = Normalize(new Point2f((float)fitted.Vx, (float)fitted.Vy));
        var normal = new Point2f(-direction.Y, direction.X);
        var residualPixels = inliers.Average(point => DistanceToLine(point, pointOnLine, normal));
        var projections = inliers.Select(point => Dot(new Point2f(point.X - pointOnLine.X, point.Y - pointOnLine.Y), direction)).ToArray();
        var span = Math.Max(1, projections.Max() - projections.Min());
        return new ParametricLine(pointOnLine, direction, Math.Clamp(residualPixels / span, 0, 1));
    }

    private static Point2f Normalize(Point2f vector)
    {
        var length = Math.Sqrt((vector.X * vector.X) + (vector.Y * vector.Y));
        return length <= 1e-9 ? default : new Point2f((float)(vector.X / length), (float)(vector.Y / length));
    }

    private static double DistanceToLine(Point2f point, Point2f pointOnLine, Point2f normal) =>
        Math.Abs(((point.X - pointOnLine.X) * normal.X) + ((point.Y - pointOnLine.Y) * normal.Y));

    private static double Median(IReadOnlyList<double> sorted)
    {
        if (sorted.Count == 0) return 0;
        var middle = sorted.Count / 2;
        return sorted.Count % 2 == 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
    }

    private static Point2f? Intersect(ParametricLine first, ParametricLine second)
    {
        var cross = Cross(first.Direction, second.Direction);
        if (Math.Abs(cross) < 0.02) return null;
        var delta = new Point2f(second.Point.X - first.Point.X, second.Point.Y - first.Point.Y);
        var amount = Cross(delta, second.Direction) / cross;
        return new Point2f((float)(first.Point.X + (first.Direction.X * amount)), (float)(first.Point.Y + (first.Direction.Y * amount)));
    }

    private static IEnumerable<double> CandidateOrientations(IEnumerable<Segment> segments)
    {
        const int bins = 36;
        var histogram = new double[bins];
        foreach (var segment in segments)
        {
            var index = Math.Min(bins - 1, (int)Math.Floor(segment.Angle / Math.PI * bins));
            histogram[index] += segment.Length;
        }

        return histogram
            .Select(static (weight, index) => (Weight: weight, Index: index))
            .Where(static item => item.Weight > 0)
            .OrderByDescending(static item => item.Weight)
            .Take(10)
            .Select(static item => (item.Index + 0.5) * Math.PI / bins);
    }

    private static double AngularDistance(double first, double second)
    {
        var difference = Math.Abs(NormalizeAngle(first) - NormalizeAngle(second));
        return Math.Min(difference, Math.PI - difference);
    }

    private static double NormalizeAngle(double angle)
    {
        angle %= Math.PI;
        return angle < 0 ? angle + Math.PI : angle;
    }

    private static double Cross(Point2f first, Point2f second) => (first.X * second.Y) - (first.Y * second.X);
    private static double Dot(Point2f point, Point2f vector) => (point.X * vector.X) + (point.Y * vector.Y);

    private readonly record struct ParametricLine(Point2f Point, Point2f Direction, double Residual);
    private readonly record struct Segment(Point P1Raw, Point P2Raw)
    {
        public Point2f P1 => new(P1Raw.X, P1Raw.Y);
        public Point2f P2 => new(P2Raw.X, P2Raw.Y);
        public Point2f Midpoint => new((P1Raw.X + P2Raw.X) / 2f, (P1Raw.Y + P2Raw.Y) / 2f);
        public double Length => Math.Sqrt(Math.Pow(P2Raw.X - P1Raw.X, 2) + Math.Pow(P2Raw.Y - P1Raw.Y, 2));
        public double Angle => NormalizeAngle(Math.Atan2(P2Raw.Y - P1Raw.Y, P2Raw.X - P1Raw.X));
    }
}
