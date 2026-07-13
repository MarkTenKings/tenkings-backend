using TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Pylon.Host;

/// <summary>
/// Hardware-independent alias selection used before any Pylon parameter write.
/// The selected candidate carries the exact node instance that must be reused
/// for both the write and its readback.
/// </summary>
internal sealed record PylonParameterCandidate<TNode>(
    string Name,
    TNode Node,
    bool IsEmpty,
    bool IsReadable,
    bool IsWritable,
    RigSettingKind? ValueKind)
    where TNode : class;

internal static class PylonParameterSelection
{
    internal static PylonParameterCandidate<TNode>? SelectFirstCompatible<TNode>(
        RigSettingRequirement requirement,
        IEnumerable<PylonParameterCandidate<TNode>> candidates)
        where TNode : class
    {
        ArgumentNullException.ThrowIfNull(requirement);
        ArgumentNullException.ThrowIfNull(candidates);
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate.Name) || candidate.Node is null ||
                candidate.IsEmpty || !candidate.IsReadable || !candidate.IsWritable ||
                !IsKindCompatible(requirement.Kind, candidate.ValueKind))
            {
                continue;
            }

            return candidate;
        }

        return null;
    }

    internal static IReadOnlyList<string> KnownParameterNames(string logicalName) => logicalName switch
    {
        // Preserve the deployed ace/pylon aliases in preference order.
        "ExposureTime" => ["ExposureTime", "ExposureTimeAbs"],
        "Gain" => ["Gain", "GainAbs", "GainRaw"],
        _ => [logicalName],
    };

    private static bool IsKindCompatible(RigSettingKind required, RigSettingKind? actual) =>
        required == actual ||
        (required == RigSettingKind.Float && actual == RigSettingKind.Integer);
}
