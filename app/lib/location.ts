import * as Location from "expo-location";

export async function currentDeviceLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Location access is off. Place the issue pin on the map to continue.");
  if (!(await Location.hasServicesEnabledAsync())) throw new Error("Device location is switched off. Place the issue pin on the map to continue.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Location took too long. Place a map pin, or try GPS again outdoors.")), 20000); }),
    ]);
    return { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: location.coords.accuracy != null && Number.isFinite(location.coords.accuracy) && location.coords.accuracy >= 0 ? location.coords.accuracy : null };
  } finally { clearTimeout(timer); }
}
