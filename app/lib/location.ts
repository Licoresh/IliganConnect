import * as Location from "expo-location";

export async function currentDeviceLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Location access is off. Allow it in your device settings, or place the pin manually.");
  if (!(await Location.hasServicesEnabledAsync())) throw new Error("Device location is switched off. Turn it on, or place the pin manually.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Location took too long. Try again outdoors, or place the pin manually.")), 20000); }),
    ]);
    return { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: location.coords.accuracy };
  } finally { clearTimeout(timer); }
}
