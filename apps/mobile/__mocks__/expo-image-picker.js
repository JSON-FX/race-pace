// expo-image-picker binds a native module at import, which jest can't provide.
// The profile screen only pulls it in transitively (via lib/profileImage); no
// test drives the picker, so a dismissed-result stub keeps imports resolvable.
module.exports = {
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true, status: "granted" }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: "Images", Videos: "Videos", All: "All" },
};
