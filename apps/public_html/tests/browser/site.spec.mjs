import { test, expect } from "@playwright/test";
const routes = [
  "/",
  "/product/",
  "/why-mycrobo/",
  "/vision/",
  "/contact/",
  "/control/",
  "/product/why-mycrobo/",
];
for (const route of routes)
  test(`page ${route}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto(route);
    expect(response.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(page.locator(".site-footer")).toBeVisible();
    expect(errors).toEqual([]);
  });
test("navigation and preview", async ({ page }) => {
  await page.goto("/");
  if (await page.getByRole("button", { name: "Open menu" }).isVisible())
    await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .locator("nav")
    .getByRole("link", { name: "Product", exact: true })
    .click();
  await expect(page).toHaveURL(/\/product\//);
  if (await page.getByRole('button', { name: 'Open menu' }).isVisible())
    await page.getByRole('button', { name: 'Open menu' }).click();
  const cta = page.getByRole("button", { name: "Meet MyCrobo", exact: false });
  for (const button of await cta.all())
    if (await button.isVisible()) {
      await button.click();
      break;
    }
  await expect(page.locator(".clone-composer input")).toBeVisible();
  await page.locator(".clone-composer input").fill("Thanks, got it");
  await page.getByRole("button", { name: "Send sample message" }).click();
  await expect(page.locator(".clone-messages")).toContainText("Thanks, got it");
  await page.keyboard.press("Escape");
  await expect(page.locator(".clone-composer")).toHaveCount(0);
});
test("attention and relationship tabs", async ({ page }) => {
  await page.goto("/product/");
  for (const label of ["Your tasks", "Follow-ups", "No reply", "Decisions"]) {
    await page.getByRole("tab", { name: new RegExp(label) }).click();
    await expect(
      page.getByRole("tab", { name: new RegExp(label) }),
    ).toHaveAttribute("aria-selected", "true");
  }
  await page.goto("/why-mycrobo/");
  for (const label of ["Family", "Close friend", "Partner", "Work"]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(
      page.getByRole("tab", { name: label, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  }
});
test("contact validation, success and failure", async ({ page }) => {
  await page.goto("/contact/");
  await page.getByRole("button", { name: "Send message" }).click();
  expect(
    await page
      .locator("input[name=name]")
      .evaluate((el) => el.validity.valueMissing),
  ).toBe(true);
  await page.locator("input[name=name]").fill("Test visitor");
  await page.locator("input[name=email]").fill("test@example.com");
  await page.locator("textarea").fill("Testing the frontend contact flow.");
  await page.route("https://formsubmit.co/ajax/**", (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".form-status")).toContainText("Message sent");
  await page.locator("input[name=name]").fill("Test visitor");
  await page.locator("input[name=email]").fill("test@example.com");
  await page.locator("textarea").fill("Testing failure handling.");
  await page.route("https://formsubmit.co/ajax/**", (route) =>
    route.fulfill({ status: 503, json: { success: false } }),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".form-status")).toContainText("couldn't send");
});
