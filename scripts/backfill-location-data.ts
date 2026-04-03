import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BACKFILL_DATA: Record<string, Prisma.LocationUpdateInput> = {
  "dallas-stars-coamerica-center": {
    locationType: "arena",
    locationStatus: "active",
    latitude: 33.1026,
    longitude: -96.8204,
    venueCenterLat: 33.1026,
    venueCenterLng: -96.8204,
    geofenceRadiusM: 300,
    city: "Frisco",
    state: "TX",
    zip: "75034",
    hours: "Open on event days",
  },
  "dallas-stars-mckinney": {
    locationType: "arena",
    locationStatus: "active",
    latitude: 33.1745,
    longitude: -96.715,
    venueCenterLat: 33.1745,
    venueCenterLng: -96.715,
    geofenceRadiusM: 200,
    city: "McKinney",
    state: "TX",
    zip: "75070",
    hours: "Open on event days",
  },
  "dallas-stars-plano": {
    locationType: "arena",
    locationStatus: "active",
    latitude: 33.0198,
    longitude: -96.763,
    venueCenterLat: 33.0198,
    venueCenterLng: -96.763,
    geofenceRadiusM: 200,
    city: "Plano",
    state: "TX",
    zip: "75093",
    hours: "Open on event days",
  },
  "folsom-outlet-mall": {
    locationType: "mall",
    locationStatus: "active",
    latitude: 38.669,
    longitude: -121.1415,
    venueCenterLat: 38.6688,
    venueCenterLng: -121.142,
    geofenceRadiusM: 500,
    city: "Folsom",
    state: "CA",
    zip: "95630",
    hours: "Mon-Sat 10 AM - 9 PM | Sun 11 AM - 7 PM",
  },
  "folsom-premium-outlets": {
    locationType: "mall",
    locationStatus: "active",
    latitude: 38.669,
    longitude: -121.1415,
    venueCenterLat: 38.6688,
    venueCenterLng: -121.142,
    geofenceRadiusM: 500,
    city: "Folsom",
    state: "CA",
    zip: "95630",
    hours: "Mon-Sat 10 AM - 9 PM | Sun 11 AM - 7 PM",
    hasIndoorMap: true,
    walkingTimeMin: 3,
    landmarks: ["Nike Factory Store", "Coach Outlet", "Adidas", "Food Court"],
    walkingDirections: [
      { step: 1, instruction: "Head towards Nike Factory Store", landmark: "Nike Factory Store", distanceFt: 150 },
      { step: 2, instruction: "Turn right at the food court", landmark: "Food Court", distanceFt: 100 },
      {
        step: 3,
        instruction: "We're between Coach and Adidas - look for the gold machine!",
        landmark: "Coach Outlet",
        distanceFt: 50,
      },
    ] as Prisma.InputJsonValue,
    checkpoints: [
      {
        id: 1,
        name: "Start",
        lat: 38.6685,
        lng: -121.1425,
        radiusM: 20,
        tkdReward: 25,
        message: "The Hunt begins! Head towards the outlets.",
      },
      {
        id: 2,
        name: "Halfway Hero",
        lat: 38.6688,
        lng: -121.1418,
        radiusM: 15,
        tkdReward: 50,
        message: "Halfway there! Keep going past the food court.",
      },
      {
        id: 3,
        name: "Treasure Found!",
        lat: 38.669,
        lng: -121.1415,
        radiusM: 10,
        tkdReward: 100,
        message: "You found Ten Kings! Claim your reward at the machine.",
      },
    ] as Prisma.InputJsonValue,
    venueMapData: {
      mapKey: "folsom-premium-outlets-v1",
      venueShape: "u",
      primaryEntranceLabel: "Main Entrance",
      destinationLabel: "Ten Kings Machine",
    } as Prisma.InputJsonValue,
  },
  "north-premium-outlet-mall": {
    locationType: "mall",
    locationStatus: "active",
    latitude: 36.161,
    longitude: -115.157,
    venueCenterLat: 36.161,
    venueCenterLng: -115.157,
    geofenceRadiusM: 400,
    city: "Las Vegas",
    state: "NV",
    zip: "89106",
    hours: "Mon-Sat 10 AM - 9 PM | Sun 10 AM - 8 PM",
  },
  "ohkay-hotel-casino": {
    locationType: "casino",
    locationStatus: "active",
    latitude: 36.05,
    longitude: -106.065,
    venueCenterLat: 36.05,
    venueCenterLng: -106.065,
    geofenceRadiusM: 200,
    city: "Ohkay Owingeh",
    state: "NM",
    zip: "87566",
    hours: "Open 24/7",
  },
  "online-collect-tenkings-co": {
    locationType: "other",
    locationStatus: "active",
  },
  "sacramento-kings-golden-1-center": {
    locationType: "arena",
    locationStatus: "active",
    latitude: 38.5802,
    longitude: -121.4998,
    venueCenterLat: 38.5802,
    venueCenterLng: -121.4998,
    geofenceRadiusM: 300,
    city: "Sacramento",
    state: "CA",
    zip: "95814",
    hours: "Open on event days | 10 AM - 10 PM",
  },
  "sutter-health-park": {
    locationType: "stadium",
    locationStatus: "active",
    latitude: 38.5805,
    longitude: -121.5131,
    venueCenterLat: 38.5805,
    venueCenterLng: -121.5131,
    geofenceRadiusM: 300,
    city: "West Sacramento",
    state: "CA",
    zip: "95691",
    hours: "Open on event days | 11 AM - 9 PM",
  },
  "the-nerd-neonopolis": {
    locationType: "other",
    locationStatus: "active",
    latitude: 36.1697,
    longitude: -115.1414,
    venueCenterLat: 36.1697,
    venueCenterLng: -115.1414,
    geofenceRadiusM: 150,
    city: "Las Vegas",
    state: "NV",
    zip: "89101",
    hours: "Mon-Sun 10 AM - 10 PM",
  },
};

async function backfill() {
  for (const [slug, data] of Object.entries(BACKFILL_DATA)) {
    const location = await prisma.location.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });

    if (!location) {
      console.warn(`Skipping missing location: ${slug}`);
      continue;
    }

    await prisma.location.update({
      where: { slug },
      data,
    });

    console.log(`Updated: ${slug}`);
  }

  console.log("Done! Location backfill complete.");
  console.log("Note: verify exact machine coordinates for every venue before production rollout.");
}

backfill()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
