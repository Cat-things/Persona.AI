import { expect, test, type Page } from "@playwright/test";

const password = "password123";

async function signIn(page: Page, username: string) {
  await page.goto("/");
  // First visit on a fresh instance lands on setup/register; later ones on login.
  await page.waitForURL(/\/(login|register)/);
  if (page.url().includes("/register")) {
    await page.fill("#username", username);
    await page.fill("#password", password);
    await page.getByRole("button", { name: /create (admin )?account/i }).click();
  } else {
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.fill("#username", username);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Create account" }).click();
  }
  await page.waitForURL((u) => !/login|register/.test(u.pathname));
}

test("create a character, chat, swipe and rate", async ({ page }, info) => {
  const user = `smoke_${info.project.name}`;
  await signIn(page, user);

  await page.goto("/create");
  await page.fill("#name", `Navigator ${info.project.name}`);
  await page.fill("#tagline", "Knows every star");
  await page.fill("#greeting", "Hello {{user}}, ready to fly?");
  await page.getByRole("button", { name: "Create character" }).click();

  await page.waitForURL(/\/chat\//);
  const main = page.getByRole("main");
  await expect(main.getByText(`Hello ${user}, ready to fly?`)).toBeVisible();

  await page.fill("#composer", "Where are we going?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(main.getByText('You said "Where are we going?"').first()).toBeVisible();
  await expect(main.getByText("1/1")).toBeVisible();

  await page.getByRole("button", { name: "Generate a new reply" }).click();
  await expect(main.getByText("2/2")).toBeVisible();
  await page.getByRole("button", { name: "Previous reply" }).click();
  await expect(main.getByText("1/2")).toBeVisible();

  await page.getByRole("radio", { name: "3 stars" }).click();
  await expect(page.getByRole("radio", { name: "3 stars" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Discover lists the new character and the sidebar has the chat.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: `Navigator ${info.project.name}` }).first(),
  ).toBeVisible();
});
