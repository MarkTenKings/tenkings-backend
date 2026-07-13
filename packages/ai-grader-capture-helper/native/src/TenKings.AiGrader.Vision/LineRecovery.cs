using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

internal static class LineRecovery
{
    public static void Add(Mat edges, ICollection<QuadCandidate> candidates)
    {
        var minimum = Math.Max(30, Math.Min(edges.Width, edges.Height) * 0.09);
        var segments = Cv2.HoughLinesP(edges, 1, Math.PI / 180, 38, minimum, 28)
            .Select(line => new Segment(line.P1, line.P2))
            .Where(segment => segment.Length >= minimum)
            .OrderByDescending(static segment => segment.Length)
            .Take(120)
            .ToArray();
        if (segments.Length < 4) return;

        var dominant = DominantOrientation(segments);
        var perpendicular = NormalizeAngle(dominant + (Math.PI / 2));
        var first = segments.Where(segment => AngularDistance(segment.Angle, dominant) < Math.PI / 10).ToArray();
        var second = segments.Where(segment => AngularDistance(segment.Angle, perpendicular) < Math.PI / 9).ToArray();
        if (!TryFitOuterPair(first, dominant, out var firstLow, out var firstHigh) ||
            !TryFitOuterPair(second, perpendicular, out var secondLow, out var secondHigh)) return;

        var intersections = new[]
        {
            Intersect(firstLow, secondLow),
            Intersect(firstHigh, secondLow),
            Intersect(firstHigh, secondHigh),
            Intersect(firstLow, secondHigh),
        };
        if (intersections.Any(static point => point is null)) return;
        var corners = intersections.Cast<Point2f>().ToArray();
        var marginX = edges.Width * 0.12;
        var marginY = edges.Height * 0.12;
        if (corners.Any(point => point.X < -marginX || point.Y < -marginY || point.X > edges.Width + marginX || point.Y > edges.Height + marginY)) return;
        var residual = Math.Clamp((firstLow.Residual + firstHigh.Residual + secondLow.Residual + secondHigh.Residual) / 4, 0, 1);
        candidates.Add(new QuadCandidate(corners, "line_recovery", residual));
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
        return separation > 30 && low.Direction != default && high.Direction != default;
    }

    private static ParametricLine FitLine(IReadOnlyList<Segment> segments)
    {
        var points = segments.SelectMany(static segment => new[] { segment.P1, segment.P2 }).ToArray();
        var meanX = points.Average(static point => point.X);
        var meanY = points.Average(static point => point.Y);
        double xx = 0, xy = 0, yy = 0;
        foreach (var point in points)
        {
            var dx = point.X - meanX;
            var dy = point.Y - meanY;
            xx += dx * dx;
            xy += dx * dy;
            yy += dy * dy;
        }

        var angle = 0.5 * Math.Atan2(2 * xy, xx - yy);
        var direction = new Point2f((float)Math.Cos(angle), (float)Math.Sin(angle));
        var normal = new Point2f(-direction.Y, direction.X);
        var residualPixels = points.Average(point => Math.Abs(((point.X - meanX) * normal.X) + ((point.Y - meanY) * normal.Y)));
        var span = Math.Max(1, segments.Max(static segment => segment.Length));
        return new ParametricLine(new Point2f((float)meanX, (float)meanY), direction, Math.Clamp(residualPixels / span, 0, 1));
    }

    private static Point2f? Intersect(ParametricLine first, ParametricLine second)
    {
        var cross = Cross(first.Direction, second.Direction);
        if (Math.Abs(cross) < 0.02) return null;
        var delta = new Point2f(second.Point.X - first.Point.X, second.Point.Y - first.Point.Y);
        var amount = Cross(delta, second.Direction) / cross;
        return new Point2f((float)(first.Point.X + (first.Direction.X * amount)), (float)(first.Point.Y + (first.Direction.Y * amount)));
    }

    private static double DominantOrientation(IEnumerable<Segment> segments)
    {
        const int bins = 36;
        var histogram = new double[bins];
        foreach (var segment in segments)
        {
            var index = Math.Min(bins - 1, (int)Math.Floor(segment.Angle / Math.PI * bins));
            histogram[index] += segment.Length;
        }

        var best = Array.IndexOf(histogram, histogram.Max());
        return (best + 0.5) * Math.PI / bins;
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
