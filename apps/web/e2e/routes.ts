/** Every creator/client screen the copy lint visits. Add routes as pages are built. */
export const CREATOR_CLIENT_ROUTES: string[] = [
  "/",
  "/studio",
  "/studio?as=artist.test.near",
  "/studio/new?as=artist.test.near",
  "/studio/new?mode=standalone&as=artist.test.near",
  "/studio/p1.soulprint.test.near?as=artist.test.near",
  "/capture/p1.soulprint.test.near",
  "/c/p1.soulprint.test.near",
];
