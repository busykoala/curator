export type MetadataProfile = {
  id: number;
  primaryAlbumTypes: Array<{ albumType: { name: string }; allowed: boolean }>;
  secondaryAlbumTypes: Array<{ albumType: { name: string }; allowed: boolean }>;
};
export type RequestedRelease = { albumType?: string; secondaryTypes?: Array<{ name: string } | string> };

export function metadataProfileForReleases(profiles: MetadataProfile[], preferredId: number | undefined, releases: RequestedRelease[]) {
  const allows = (profile: MetadataProfile) => releases.every(release => {
    const primary = (release.albumType || "Album").toLowerCase();
    const secondary = release.secondaryTypes?.length ? release.secondaryTypes.map(type => typeof type === "string" ? type : type.name) : ["Studio"];
    return profile.primaryAlbumTypes.some(type => type.allowed && type.albumType.name.toLowerCase() === primary)
      && secondary.every(name => profile.secondaryAlbumTypes.some(type => type.allowed && type.albumType.name.toLowerCase() === name.toLowerCase()));
  });
  const profile = profiles.find(profile => profile.id === preferredId && allows(profile)) ?? profiles.find(allows);
  if (!profile) throw new Error("This release type is not enabled in the music catalogue. Please enable it in Lidarr and try again.");
  return profile.id;
}
