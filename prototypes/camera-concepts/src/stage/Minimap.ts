// ============================================================
// CAMERA LAB — TOP-DOWN MINIMAP (why the camera is where it is)
// A 2D view of the arena from above: both Beys with velocity arrows, the
// midpoint, the look-ahead point, the predicted encounter, and each
// preset's camera with its horizontal field of view and the line camera →
// target. In compare view all three cameras are drawn in their colours.
// ============================================================

import type { PresetId } from '../director/CameraParams';
import type { DirectorOutput } from '../director/CameraDirector';
import type { FightFrame, Vec3 } from '../fight/FightFrame';
import type { CameraPose } from './LabStage';

// ---------------- MINIMAP TUNING ----------------
const VIEW_RADIUS_M = 22;           // Metres from the centre to the minimap edge (cameras sit outside the arena).
const ARENA_RADIUS_M = 12;
const RINGOUT_RADIUS_M = 12.9;
const FRUSTUM_LENGTH_M = 7;
const PRESET_CSS: Readonly<Record<PresetId, string>> = { A: '#6fd3ff', B: '#ffb347', C: '#ff4fa3' };
// ------------------------------------------------

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap: no 2D context');
    this.ctx = ctx;
  }

  draw(frame: FightFrame, poses: Readonly<Record<PresetId, CameraPose>>, outputs: Readonly<Record<PresetId, DirectorOutput>>, shown: readonly PresetId[], aspect: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.canvas.clientWidth;
    if (this.canvas.width !== Math.round(size * dpr)) {
      this.canvas.width = Math.round(size * dpr);
      this.canvas.height = Math.round(size * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    const s = size / (2 * VIEW_RADIUS_M);
    const X = (v: Vec3): number => size / 2 + v.x * s;
    const Y = (v: Vec3): number => size / 2 + v.z * s;

    c.fillStyle = 'rgba(8,10,16,0.82)';
    c.fillRect(0, 0, size, size);
    c.strokeStyle = '#2d3645';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(size / 2, size / 2, ARENA_RADIUS_M * s, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([3, 4]);
    c.beginPath();
    c.arc(size / 2, size / 2, RINGOUT_RADIUS_M * s, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);

    // Cameras: position, horizontal FOV wedge, line to the target.
    for (const id of shown) {
      const pose = poses[id];
      const col = PRESET_CSS[id];
      const yaw = Math.atan2(pose.focus.x - pose.eye.x, pose.focus.z - pose.eye.z);
      const hHalf = Math.atan(Math.tan((pose.fov * Math.PI) / 360) * aspect);
      c.fillStyle = col + '22';
      c.strokeStyle = col + '88';
      c.beginPath();
      c.moveTo(X(pose.eye), Y(pose.eye));
      c.lineTo(X(pose.eye) + Math.sin(yaw - hHalf) * FRUSTUM_LENGTH_M * 2 * s, Y(pose.eye) + Math.cos(yaw - hHalf) * FRUSTUM_LENGTH_M * 2 * s);
      c.lineTo(X(pose.eye) + Math.sin(yaw + hHalf) * FRUSTUM_LENGTH_M * 2 * s, Y(pose.eye) + Math.cos(yaw + hHalf) * FRUSTUM_LENGTH_M * 2 * s);
      c.closePath();
      c.fill();
      c.stroke();
      c.strokeStyle = col;
      c.beginPath();
      c.moveTo(X(pose.eye), Y(pose.eye));
      c.lineTo(X(pose.focus), Y(pose.focus));
      c.stroke();
      c.fillStyle = col;
      c.beginPath();
      c.arc(X(pose.eye), Y(pose.eye), 4, 0, Math.PI * 2);
      c.fill();
      c.font = '600 10px ui-monospace, Consolas, monospace';
      c.fillText(id, X(pose.eye) + 6, Y(pose.eye) - 5);
      const d = outputs[id].debug;
      // Look-ahead point and predicted encounter for this preset.
      c.fillStyle = '#ff4fd8';
      c.fillRect(X(d.lookAheadPoint) - 2.5, Y(d.lookAheadPoint) - 2.5, 5, 5);
      if (d.encounterPoint) {
        c.strokeStyle = '#ff9a3c';
        c.beginPath();
        c.arc(X(d.encounterPoint), Y(d.encounterPoint), 5, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // Midpoint and Beys with velocity.
    const mid = { x: (frame.first.position.x + frame.second.position.x) / 2, y: 0, z: (frame.first.position.z + frame.second.position.z) / 2 };
    c.strokeStyle = '#7fe0ff';
    c.beginPath();
    c.arc(X(mid), Y(mid), 3.5, 0, Math.PI * 2);
    c.stroke();
    const bey = (p: Vec3, v: Vec3, col: string, label: string): void => {
      c.strokeStyle = col;
      c.beginPath();
      c.moveTo(X(p), Y(p));
      c.lineTo(X(p) + v.x * 0.25 * s, Y(p) + v.z * 0.25 * s);
      c.stroke();
      c.fillStyle = col;
      c.beginPath();
      c.arc(X(p), Y(p), 4.5, 0, Math.PI * 2);
      c.fill();
      c.fillText(label, X(p) + 6, Y(p) + 12);
    };
    bey(frame.first.position, frame.first.velocity, '#7fe07f', 'P');
    bey(frame.second.position, frame.second.velocity, '#ff6060', 'O');
  }
}
