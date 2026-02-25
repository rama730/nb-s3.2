import { ensureE2EFixtures } from "./fixtures";

async function globalSetup() {
  ensureE2EFixtures();
}

export default globalSetup;
