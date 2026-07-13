using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

/// <summary>Exact bounded coordinate transforms for the fixed sensor mounting.</summary>
public static class SensorCoordinateTransform
{
    public static (int Width, int Height) PortraitSize(int sensorWidth, int sensorHeight, SensorOrientation orientation)
    {
        ValidateDimensions(sensorWidth, sensorHeight);
        orientation.Validate();
        return orientation.SensorToPortraitRotationDegrees is 90 or 270
            ? (sensorHeight, sensorWidth)
            : (sensorWidth, sensorHeight);
    }

    public static PointD RawSensorToPortrait(
        PointD rawSensor,
        int sensorWidth,
        int sensorHeight,
        SensorOrientation orientation)
    {
        ValidatePoint(rawSensor);
        var (portraitWidth, portraitHeight) = PortraitSize(sensorWidth, sensorHeight, orientation);
        var rotated = orientation.SensorToPortraitRotationDegrees switch
        {
            0 => rawSensor,
            90 => new PointD((sensorHeight - 1) - rawSensor.Y, rawSensor.X),
            180 => new PointD((sensorWidth - 1) - rawSensor.X, (sensorHeight - 1) - rawSensor.Y),
            270 => new PointD(rawSensor.Y, (sensorWidth - 1) - rawSensor.X),
            _ => throw new ArgumentOutOfRangeException(nameof(orientation)),
        };
        return new PointD(
            orientation.MirrorHorizontal ? (portraitWidth - 1) - rotated.X : rotated.X,
            orientation.MirrorVertical ? (portraitHeight - 1) - rotated.Y : rotated.Y);
    }

    public static PointD PortraitToRawSensor(
        PointD portrait,
        int sensorWidth,
        int sensorHeight,
        SensorOrientation orientation)
    {
        ValidatePoint(portrait);
        var (portraitWidth, portraitHeight) = PortraitSize(sensorWidth, sensorHeight, orientation);
        var unmirrored = new PointD(
            orientation.MirrorHorizontal ? (portraitWidth - 1) - portrait.X : portrait.X,
            orientation.MirrorVertical ? (portraitHeight - 1) - portrait.Y : portrait.Y);
        return orientation.SensorToPortraitRotationDegrees switch
        {
            0 => unmirrored,
            90 => new PointD(unmirrored.Y, (sensorHeight - 1) - unmirrored.X),
            180 => new PointD((sensorWidth - 1) - unmirrored.X, (sensorHeight - 1) - unmirrored.Y),
            270 => new PointD((sensorWidth - 1) - unmirrored.Y, unmirrored.X),
            _ => throw new ArgumentOutOfRangeException(nameof(orientation)),
        };
    }

    internal static void ApplyToImage(Mat source, Mat destination, SensorOrientation orientation)
    {
        orientation.Validate();
        switch (orientation.SensorToPortraitRotationDegrees)
        {
            case 0:
                source.CopyTo(destination);
                break;
            case 90:
                Cv2.Rotate(source, destination, RotateFlags.Rotate90Clockwise);
                break;
            case 180:
                Cv2.Rotate(source, destination, RotateFlags.Rotate180);
                break;
            case 270:
                Cv2.Rotate(source, destination, RotateFlags.Rotate90Counterclockwise);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(orientation));
        }

        if (orientation.MirrorHorizontal) Cv2.Flip(destination, destination, FlipMode.Y);
        if (orientation.MirrorVertical) Cv2.Flip(destination, destination, FlipMode.X);
    }

    internal static PointD CorrectedSensorToRaw(PointD correctedSensor, LensCalibration? lens)
    {
        if (lens is null) return correctedSensor;
        var matrix = lens.CameraMatrix;
        var coefficients = lens.DistortionCoefficients;
        var fx = matrix[0];
        var skew = matrix[1];
        var cx = matrix[2];
        var fy = matrix[4];
        var cy = matrix[5];
        var y = (correctedSensor.Y - cy) / fy;
        var x = (correctedSensor.X - cx - (skew * y)) / fx;
        var r2 = (x * x) + (y * y);
        var r4 = r2 * r2;
        var r6 = r4 * r2;
        double Coefficient(int index) => index < coefficients.Count ? coefficients[index] : 0;
        var numerator = 1 + (Coefficient(0) * r2) + (Coefficient(1) * r4) + (Coefficient(4) * r6);
        var denominator = 1 + (Coefficient(5) * r2) + (Coefficient(6) * r4) + (Coefficient(7) * r6);
        var radial = numerator / denominator;
        var p1 = Coefficient(2);
        var p2 = Coefficient(3);
        var distortedX = (x * radial) + (2 * p1 * x * y) + (p2 * (r2 + (2 * x * x))) +
            (Coefficient(8) * r2) + (Coefficient(9) * r4);
        var distortedY = (y * radial) + (p1 * (r2 + (2 * y * y))) + (2 * p2 * x * y) +
            (Coefficient(10) * r2) + (Coefficient(11) * r4);
        return new PointD(
            (fx * distortedX) + (skew * distortedY) + cx,
            (fy * distortedY) + cy);
    }

    private static void ValidateDimensions(int width, int height)
    {
        if (width is < 1 or > Mono8Frame.MaxDimension || height is < 1 or > Mono8Frame.MaxDimension)
            throw new ArgumentOutOfRangeException(nameof(width));
    }

    private static void ValidatePoint(PointD point)
    {
        if (!double.IsFinite(point.X) || !double.IsFinite(point.Y))
            throw new ArgumentOutOfRangeException(nameof(point));
    }
}
