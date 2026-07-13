using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

internal static class VisionMath
{
    public static Point2f[] OrderCorners(IEnumerable<Point2f> input)
    {
        var points = input.ToArray();
        if (points.Length != 4) return Array.Empty<Point2f>();
        var center = new Point2f(points.Average(static point => point.X), points.Average(static point => point.Y));
        var ordered = points.OrderBy(point => Math.Atan2(point.Y - center.Y, point.X - center.X)).ToArray();
        var topLeft = ordered.MinBy(static point => point.X + point.Y);
        var index = Array.IndexOf(ordered, topLeft);
        return Enumerable.Range(0, 4).Select(offset => ordered[(index + offset) % 4]).ToArray();
    }

    public static bool IsConvex(IReadOnlyList<Point2f> points)
    {
        double sign = 0;
        for (var index = 0; index < 4; index++)
        {
            var a = points[index];
            var b = points[(index + 1) % 4];
            var c = points[(index + 2) % 4];
            var cross = ((b.X - a.X) * (c.Y - b.Y)) - ((b.Y - a.Y) * (c.X - b.X));
            if (Math.Abs(cross) < 1e-4) return false;
            if (sign == 0) sign = Math.Sign(cross);
            else if (Math.Sign(cross) != Math.Sign(sign)) return false;
        }

        return true;
    }

    public static double ConvexityScore(IReadOnlyList<Point2f> points)
    {
        var diagonals = new[] { Distance(points[0], points[2]), Distance(points[1], points[3]) };
        var shortest = Enumerable.Range(0, 4).Min(index => Distance(points[index], points[(index + 1) % 4]));
        return shortest <= 1 ? 0 : Math.Clamp(diagonals.Min() / (shortest * 1.1), 0, 1);
    }

    public static double MinimumClearance(IEnumerable<Point2f> corners, int width, int height) =>
        corners.Min(point => Math.Min(
            Math.Min(point.X, width - 1 - point.X) / width,
            Math.Min(point.Y, height - 1 - point.Y) / height));

    public static double ContourResidual(IReadOnlyList<Point> contour, IReadOnlyList<Point2f> corners)
    {
        var perimeter = Enumerable.Range(0, 4).Sum(index => Distance(corners[index], corners[(index + 1) % 4]));
        if (perimeter <= 1) return 1;
        var mean = contour.Average(point => Enumerable.Range(0, 4).Min(index =>
            DistanceToSegment(new Point2f(point.X, point.Y), corners[index], corners[(index + 1) % 4])));
        return Math.Clamp(mean / (perimeter / 4), 0, 1);
    }

    public static Point2f[] RefineCorners(Point2f[] corners, Mat gradientX, Mat gradientY, int radius)
    {
        var refined = new Point2f[corners.Length];
        for (var index = 0; index < corners.Length; index++)
        {
            var source = corners[index];
            var best = source;
            double response = -1;
            for (var y = (int)Math.Round(source.Y) - radius; y <= (int)Math.Round(source.Y) + radius; y++)
            for (var x = (int)Math.Round(source.X) - radius; x <= (int)Math.Round(source.X) + radius; x++)
            {
                if (x < 1 || y < 1 || x >= gradientX.Width - 1 || y >= gradientX.Height - 1) continue;
                var gx = gradientX.At<float>(y, x);
                var gy = gradientY.At<float>(y, x);
                var magnitude = (gx * gx) + (gy * gy);
                if (magnitude <= response) continue;
                response = magnitude;
                best = new Point2f(x, y);
            }

            refined[index] = best;
        }

        return OrderCorners(refined);
    }

    public static double[] ComputeHomography(IReadOnlyList<PointD> source, IReadOnlyList<PointD> destination)
    {
        var from = source.Select(static point => new Point2f((float)point.X, (float)point.Y)).ToArray();
        var to = destination.Select(static point => new Point2f((float)point.X, (float)point.Y)).ToArray();
        using var matrix = Cv2.GetPerspectiveTransform(from, to);
        var values = new double[9];
        for (var row = 0; row < 3; row++)
        for (var column = 0; column < 3; column++)
            values[(row * 3) + column] = matrix.At<double>(row, column);
        return values;
    }

    public static double PolygonArea(IReadOnlyList<Point2f> points)
    {
        double area = 0;
        for (var index = 0; index < points.Count; index++)
        {
            var next = (index + 1) % points.Count;
            area += (points[index].X * points[next].Y) - (points[next].X * points[index].Y);
        }

        return area / 2;
    }

    public static double PolygonArea(IReadOnlyList<PointD> points)
    {
        double area = 0;
        for (var index = 0; index < points.Count; index++)
        {
            var next = (index + 1) % points.Count;
            area += (points[index].X * points[next].Y) - (points[next].X * points[index].Y);
        }

        return area / 2;
    }

    public static double Distance(Point2f first, Point2f second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));

    public static double NormalizeRotation(double degrees)
    {
        while (degrees > 90) degrees -= 180;
        while (degrees <= -90) degrees += 180;
        return degrees;
    }

    private static double DistanceToSegment(Point2f point, Point2f start, Point2f end)
    {
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        var denominator = (dx * dx) + (dy * dy);
        var amount = denominator <= 1e-6 ? 0 : Math.Clamp((((point.X - start.X) * dx) + ((point.Y - start.Y) * dy)) / denominator, 0, 1);
        return Distance(point, new Point2f(start.X + (dx * amount), start.Y + (dy * amount)));
    }
}
