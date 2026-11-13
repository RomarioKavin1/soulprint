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
  "/c/p2.soulprint.test.near?as=client.test.near",
  "/c/p3.soulprint.test.near?as=client.test.near",
  // Review minor 11: holder screens too (signed in as the people who use them).
  "/vault/p1.soulprint.test.near?as=client.test.near",
  "/vault/p1.soulprint.test.near?as=buyer.test.near",
  "/buy/p1.soulprint.test.near?as=buyer.test.near",
  "/pay/p1.soulprint.test.near?as=shop.test.near",
  "/c/p1.soulprint.test.near?as=artist.test.near",
  // Showcase pivot: the artist page and a piece page with Collect / Support.
  "/a/artist.test.near",
  "/gallery",
  "/gallery?sort=price-asc&availability=for-sale",
  "/notes",
  "/notes?as=buyer.test.near",
  "/p/p1.soulprint.test.near?as=buyer.test.near",
];
