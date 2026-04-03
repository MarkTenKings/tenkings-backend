import VenueMapSVG from "./VenueMapSVG";
import { FOLSOM_ROUTE_POINTS, type VenueMapPoint } from "../../lib/kingsHunt";

type CheckpointVisual = {
  id: number;
  label: string;
  status: "completed" | "current" | "upcoming";
  point: VenueMapPoint;
};

type FolsomOutletsSVGProps = {
  showUser?: boolean;
  userPoint?: VenueMapPoint | null;
  huntActive?: boolean;
  checkpointVisuals?: CheckpointVisual[];
  className?: string;
};

const STORE_BLOCKS = [
  { x: 84, y: 90, w: 78, h: 56, label: "Nike", emphasis: true },
  { x: 88, y: 166, w: 82, h: 48, label: "J.Crew" },
  { x: 88, y: 228, w: 82, h: 48, label: "Levi's" },
  { x: 88, y: 290, w: 82, h: 48, label: "Gap" },
  { x: 88, y: 352, w: 82, h: 48, label: "H&M" },
  { x: 192, y: 438, w: 76, h: 34, label: "Puma" },
  { x: 284, y: 438, w: 74, h: 34, label: "Vans" },
  { x: 376, y: 438, w: 72, h: 34, label: "UGG" },
  { x: 468, y: 438, w: 86, h: 34, label: "Lids" },
  { x: 622, y: 94, w: 82, h: 52, label: "Coach", emphasis: true },
  { x: 628, y: 168, w: 76, h: 48, label: "Adidas", emphasis: true },
  { x: 628, y: 230, w: 76, h: 48, label: "MK" },
  { x: 628, y: 292, w: 76, h: 48, label: "Kate Sp." },
  { x: 628, y: 354, w: 76, h: 48, label: "Tray 6" },
];

export default function FolsomOutletsSVG({
  showUser = false,
  userPoint,
  huntActive = false,
  checkpointVisuals = [],
  className,
}: FolsomOutletsSVGProps) {
  return (
    <VenueMapSVG className={className}>
      <rect x="0" y="0" width="800" height="84" fill="rgba(255,255,255,0.02)" />
      <rect x="0" y="520" width="800" height="80" fill="#0b0b0c" />
      <text x="52" y="62" fill="#7c7c80" fontSize="15" letterSpacing="0.28em">
        FOLSOM PREMIUM OUTLETS
      </text>
      <text x="642" y="58" fill="#7c7c80" fontSize="14" letterSpacing="0.24em">
        N
      </text>
      <path d="M666 74L666 28M666 28L658 40M666 28L674 40" stroke="#d4a843" strokeWidth="3" strokeLinecap="round" />

      <rect x="14" y="104" width="56" height="326" rx="26" fill="#0d0d0d" />
      <rect x="730" y="104" width="56" height="326" rx="26" fill="#0d0d0d" />
      <rect x="234" y="504" width="332" height="64" rx="24" fill="#0d0d0d" />
      <text x="386" y="545" fill="#56565a" fontSize="18" textAnchor="middle" letterSpacing="0.18em">
        PARKING
      </text>

      <path
        d="M176 132 L176 388 Q176 456 240 456 L560 456 Q624 456 624 388 L624 132"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M188 134 L188 204 L404 204 L404 170 L602 170 L602 280 L628 302"
        fill="none"
        stroke="#d4a843"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="12 10"
        opacity="0.95"
      />

      <rect x="300" y="242" width="190" height="92" rx="20" fill="#202022" stroke="#2f2f34" strokeWidth="2" />
      <text x="395" y="284" fill="#a0a0a7" fontSize="16" textAnchor="middle" letterSpacing="0.12em">
        FOOD COURT
      </text>
      <circle cx="378" cy="308" r="8" fill="#d4a843" />
      <circle cx="410" cy="308" r="8" fill="#d4a843" />

      {STORE_BLOCKS.map((store) => (
        <g key={`${store.label}-${store.x}-${store.y}`}>
          <rect
            x={store.x}
            y={store.y}
            width={store.w}
            height={store.h}
            rx="12"
            fill="#17171a"
            stroke={store.emphasis ? "rgba(212,168,67,0.45)" : "#2a2a2e"}
            strokeWidth="2"
          />
          <text x={store.x + store.w / 2} y={store.y + store.h / 2 + 5} fill="#dadade" fontSize="14" textAnchor="middle">
            {store.label}
          </text>
        </g>
      ))}

      <g className="tk-machine-marker">
        <circle cx={FOLSOM_ROUTE_POINTS.machine.x} cy={FOLSOM_ROUTE_POINTS.machine.y} r="24" fill="rgba(212,168,67,0.22)" />
        <circle cx={FOLSOM_ROUTE_POINTS.machine.x} cy={FOLSOM_ROUTE_POINTS.machine.y} r="14" fill="#d4a843" />
      </g>
      <rect
        x={FOLSOM_ROUTE_POINTS.machine.x - 22}
        y={FOLSOM_ROUTE_POINTS.machine.y + 22}
        width="112"
        height="44"
        rx="12"
        fill="rgba(19,18,14,0.96)"
        stroke="rgba(212,168,67,0.45)"
      />
      <text x={FOLSOM_ROUTE_POINTS.machine.x + 34} y={FOLSOM_ROUTE_POINTS.machine.y + 49} fill="#d4a843" fontSize="14" textAnchor="middle">
        Ten Kings
      </text>

      {checkpointVisuals.map((checkpoint) => {
        const fill =
          checkpoint.status === "completed"
            ? "#22c55e"
            : checkpoint.status === "current"
              ? "#d4a843"
              : "#52525b";

        return (
          <g key={checkpoint.id}>
            <rect
              x={checkpoint.point.x - 10}
              y={checkpoint.point.y - 10}
              width="20"
              height="20"
              transform={`rotate(45 ${checkpoint.point.x} ${checkpoint.point.y})`}
              rx="4"
              fill={fill}
              className={checkpoint.status === "current" ? "tk-checkpoint-current" : undefined}
            />
            <text x={checkpoint.point.x} y={checkpoint.point.y - 18} fill="#d6d6db" fontSize="12" textAnchor="middle">
              {checkpoint.label}
            </text>
          </g>
        );
      })}

      {showUser && userPoint ? (
        <g>
          <circle cx={userPoint.x} cy={userPoint.y} r="18" fill="rgba(59,130,246,0.18)" />
          <circle cx={userPoint.x} cy={userPoint.y} r="8" fill="#3b82f6" />
          <text x={userPoint.x} y={userPoint.y - 22} fill="#8ec5ff" fontSize="12" textAnchor="middle">
            {huntActive ? "You" : "You Are Here"}
          </text>
        </g>
      ) : null}
    </VenueMapSVG>
  );
}
