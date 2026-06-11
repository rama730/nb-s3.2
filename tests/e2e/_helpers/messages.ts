import { expect, type Page } from "@playwright/test";

type MessageTab = "chats" | "applications" | "projects";

const tabLabels: Record<MessageTab, string> = {
  chats: "Chats",
  applications: "Applications",
  projects: "Project Groups",
};

export async function switchMessagesTab(page: Page, tab: MessageTab) {
  const legacyTab = page.getByTestId(`messages-tab-${tab}`).first();
  if (await legacyTab.isVisible().catch(() => false)) {
    await legacyTab.click({ force: true });
    return;
  }

  const label = tabLabels[tab];
  const trigger = page.getByTestId("messages-tab-trigger").or(
    page.getByRole("button", { name: /^(Chats|Applications|Project Groups)$/ }),
  ).first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click({ force: true });

  const menuItem = page.getByTestId(`messages-tab-${tab}`).or(
    page.getByRole("menuitem", { name: label }),
  ).first();
  await expect(menuItem).toBeVisible({ timeout: 5000 });
  await menuItem.click({ force: true });
  await expect(
    page.getByRole("button", { name: new RegExp(`^${label}$`) }).first(),
  ).toBeVisible({ timeout: 5000 });
}
