import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial } from 'three';

export class RoadsVisual {
  public group = new Group();
  private material = new LineBasicMaterial({ color: 0x3b82f6, depthTest: true });

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
  }

  addPath(points: Array<{ x: number; z: number }>, scale: number, y = 0.05) {
    if (points.length < 2) return;
    const positions: number[] = [];
    for (const p of points) positions.push(p.x * scale, y, p.z * scale);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const line = new Line(g, this.material);
    line.renderOrder = 5;
    this.group.add(line);
  }
}

