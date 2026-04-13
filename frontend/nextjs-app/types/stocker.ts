export type StockerShiftStatus = "pending" | "active" | "completed" | "cancelled";
export type StockerStopStatus = "pending" | "in_transit" | "arrived" | "restocking" | "completed" | "skipped";
export type StockerPositionStatus = "idle" | "driving" | "at_location" | "restocking";
export type StockerLanguage = "en" | "es";

export type LocationSummary = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number;
  machineLat: number | null;
  machineLng: number | null;
  machineGeofenceM: number;
  description: string | null;
  landmarks: string[];
  hasIndoorMap: boolean;
  walkingTimeMin: number | null;
};

export type StockerProfileData = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  language: StockerLanguage;
  isActive: boolean;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RouteLegData = {
  distanceM: number;
  durationS: number;
  encodedPolyline: string | null;
};

export type NavigationStep = {
  instruction: string;
  maneuver: string;
  distanceMeters: number;
  durationSeconds: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  polyline: string;
};

export type StockRouteData = {
  id: string;
  name: string;
  description: string | null;
  locationIds: string[];
  totalDistanceM: number | null;
  totalDurationS: number | null;
  encodedPolyline: string | null;
  legsData: RouteLegData[] | null;
  isTemplate: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  locations?: LocationSummary[];
};

export type StockerStopData = {
  id: string;
  shiftId: string;
  locationId: string;
  stopOrder: number;
  status: StockerStopStatus;
  departedPreviousAt: string | null;
  arrivedAt: string | null;
  taskStartedAt: string | null;
  taskCompletedAt: string | null;
  departedAt: string | null;
  driveTimeMin: number | null;
  driveDistanceM: number | null;
  onSiteTimeMin: number | null;
  skipReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  location?: LocationSummary;
};

export type StockerShiftData = {
  id: string;
  stockerId: string;
  routeId: string;
  assignedDate: string;
  status: StockerShiftStatus;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalDriveTimeMin: number | null;
  totalOnSiteTimeMin: number | null;
  totalIdleTimeMin: number | null;
  totalDistanceM: number | null;
  createdAt: string;
  updatedAt: string;
  route?: StockRouteData;
  stops?: StockerStopData[];
  stocker?: StockerProfileData;
};

export type LiveStockerPosition = {
  stockerId: string;
  name: string;
  phone: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  status: StockerPositionStatus;
  shiftId: string | null;
  routePolyline: string | null;
  completedStopCount: number;
  totalStopCount: number;
  nextStopName: string | null;
  nextStopEta: string | null;
  currentLocationName: string | null;
  updatedAt: string;
  shift: {
    id: string;
    routeName: string;
    clockInAt: string | null;
    totalStops: number;
    completedStops: number;
    routePolyline: string | null;
    stops: Array<StockerStopData & { location: LocationSummary }>;
  } | null;
};

export type SSEPositionsEvent = {
  type: "positions";
  stockers: LiveStockerPosition[];
  timestamp: number;
};

export type GeofenceEvent = {
  type: "location_entered" | "machine_reached";
  stopId: string;
  locationId: string;
  locationName: string;
};

export type WalkingGuidanceData = {
  walkingDistanceM: number;
  walkingDurationS: number;
  encodedPolyline: string | null;
  steps: NavigationStep[];
  locationName: string;
  locationDescription: string | null;
  landmarks: string[];
  hasIndoorMap: boolean;
  walkingTimeMin: number | null;
  machineGeofenceM: number;
  machineLocation: {
    lat: number;
    lng: number;
  };
};

export type DrivingNavigationData = {
  encodedPolyline: string | null;
  totalDistanceM: number | null;
  totalDurationS: number | null;
  nextDistanceM: number | null;
  nextDurationS: number | null;
  steps: NavigationStep[];
  generatedAt: string;
};
