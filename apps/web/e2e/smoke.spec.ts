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

test("persona and group room", async ({ page }, info) => {
  const user = `rooms_${info.project.name}`;
  await signIn(page, user);

  for (const n of ["Alder", "Briar"]) {
    await page.goto("/create");
    await page.fill("#name", `${n} ${info.project.name}`);
    await page.fill("#greeting", `${n} waves at {{user}}.`);
    await page.getByRole("button", { name: "Create character" }).click();
    await page.waitForURL(/\/chat\//);
  }

  await page.goto("/settings");
  await page.getByRole("button", { name: "New persona" }).click();
  await page.fill("#pn", "Wren");
  await page.getByLabel("Use for new chats").check();
  await page.getByRole("button", { name: "Create persona" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();

  await page.goto("/rooms/new");
  await page.fill("#rn", "Campfire");
  await page.getByRole("button", { name: new RegExp(`Alder ${info.project.name}`) }).click();
  await page.getByRole("button", { name: new RegExp(`Briar ${info.project.name}`) }).click();
  await page.getByRole("button", { name: "Create room" }).click();
  await page.waitForURL(/\/chat\//);
  const main = page.getByRole("main");
  await expect(main.getByText("Alder waves at Wren.")).toBeVisible();

  await page.fill("#composer", "Briar, tell a story");
  await page.getByRole("button", { name: "Send message" }).click();
  // Briar was named, so Briar answers; the room prompt labels the user by persona.
  await expect(main.getByText(`Briar ${info.project.name} considers your words.`)).toBeVisible();
  await expect(main.getByText('You said "Wren: Briar, tell a story"').first()).toBeVisible();
});

test("repeated refusals escalate from banner to stop popup", async ({ page }, info) => {
  await signIn(page, `refuse_${info.project.name}`);
  await page.goto("/create");
  await page.fill("#name", `Keeper ${info.project.name}`);
  await page.getByRole("button", { name: "Create character" }).click();
  await page.waitForURL(/\/chat\//);

  const send = async (text: string) => {
    await page.fill("#composer", text);
    await page.getByRole("button", { name: "Send message" }).click();
  };
  await send("please refuse 1");
  await expect(page.getByRole("status").filter({ hasText: "won't go there" })).toBeVisible();
  await send("please refuse 2");
  await expect(page.getByRole("status").filter({ hasText: "said no 2 times" })).toBeVisible();
  await send("please refuse 3");
  const dialog = page.getByRole("dialog", { name: "Please stop here" });
  await expect(dialog).toBeVisible();
  const ok = dialog.getByRole("button", { name: /I understand/ });
  await expect(ok).toBeDisabled();
  await page.screenshot({ path: `test-results/refusal-${info.project.name}.png` });
  await expect(ok).toBeEnabled({ timeout: 8000 });
  await ok.click();
  await expect(dialog).toBeHidden();
});
