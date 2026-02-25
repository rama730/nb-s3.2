import { cleanupE2EFixtures } from "./fixtures";

async function globalTeardown() {
  cleanupE2EFixtures();
}

export default globalTeardown;
