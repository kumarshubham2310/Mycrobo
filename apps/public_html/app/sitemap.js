export const dynamic = "force-static";
export default function sitemap() {
  return [
    "",
    "product/",
    "why-mycrobo/",
    "vision/",
    "contact/",
    "control/",
  ].map((path) => ({ url: `https://mycrobo.com/${path}` }));
}
