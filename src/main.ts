import { createView } from "./render/scene";
import { Player } from "./game/player";
import { Input } from "./game/input";
import { startLoop } from "./core/loop";
import { FIXED_DT } from "./config/balance";

// M0 bootstrap: tilted 3D view, a controllable capsule on flat ground, and a
// fixed-timestep loop with render interpolation. This is the spine that the
// horde (M1) and terrain (M2) plug into.

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

const view = createView(container);
const player = new Player();
view.scene.add(player.mesh);

const input = new Input();
window.addEventListener("resize", view.resize);

let renderedFrames = 0;

startLoop(
  {
    update: (dt) => {
      player.update(dt, input.moveVector());
    },
    render: (alpha) => {
      player.syncRender(alpha);
      view.followCamera(player.mesh.position.x, player.mesh.position.z);
      view.render();
      // Signal to the screenshot harness that we've drawn real frames.
      if (++renderedFrames === 3) {
        (window as unknown as { __vantageReady?: boolean }).__vantageReady = true;
      }
    },
  },
  FIXED_DT,
);
