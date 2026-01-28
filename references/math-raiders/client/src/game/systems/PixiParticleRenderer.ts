import * as PIXI from 'pixi.js';
import { ParticleSystem, Particle as GameParticle, ParticleShape } from './ParticleSystem';

/**
 * Bob Nystrom-approved particle renderer using PixiJS v8 Particle API:
 * 
 * 1. FLYWEIGHT - Share textures across all particles (one texture per shape)
 * 2. LIGHTWEIGHT - Use PIXI.Particle instead of Sprite (no children/events overhead)
 * 3. UPDATE METHOD - Sync game particles to Pixi particles each frame
 * 
 * v8 ParticleContainer + Particle = GPU-batched rendering for weak devices
 */
export class PixiParticleRenderer {
  private container: PIXI.ParticleContainer;
  private particleSystem: ParticleSystem;
  
  // FLYWEIGHT: Shared textures for each shape (created once)
  private textures: Map<ParticleShape, PIXI.Texture> = new Map();
  
  // Ticker management
  private app: PIXI.Application | null = null;
  private tickerFn: (() => void) | null = null;
  
  constructor(particleSystem: ParticleSystem) {
    // ParticleContainer batches particle transforms on GPU (faster on weak GPUs)
    this.container = new PIXI.ParticleContainer({
      dynamicProperties: {
        position: true,
        rotation: true,
        vertex: true,  // enables scale updates
        uvs: false,
        color: true    // enables tint/alpha
      },
      roundPixels: true
    });
    this.container.blendMode = 'add'; // Glow effect for all particles
    this.container.interactiveChildren = false; // Skip event traversal (perf tip from PixiJS docs)
    this.particleSystem = particleSystem;
  }
  
  /**
   * Register with Pixi app and initialize textures
   */
  public registerWithApp(app: PIXI.Application): void {
    this.app = app;
    
    // FLYWEIGHT: Create shared textures for each shape
    this.createTextures(app.renderer);
    
    // Register ticker
    this.tickerFn = () => this.update();
    app.ticker.add(this.tickerFn);
  }
  
  /**
   * FLYWEIGHT PATTERN: Create one texture per shape, share across all particles
   */
  private createTextures(renderer: PIXI.Renderer): void {
    const shapes: ParticleShape[] = ['circle', 'star', 'diamond', 'heart', 'square'];
    const size = 32; // Texture size (will be scaled by particle)
    
    for (const shape of shapes) {
      const graphics = new PIXI.Graphics();
      
      // Draw shape centered at origin
      switch (shape) {
        case 'circle':
          graphics.circle(size/2, size/2, size/2 - 2);
          break;
        case 'star':
          this.drawStar(graphics, size/2, size/2, size/2 - 2);
          break;
        case 'diamond':
          graphics.moveTo(size/2, 2);
          graphics.lineTo(size - 2, size/2);
          graphics.lineTo(size/2, size - 2);
          graphics.lineTo(2, size/2);
          graphics.closePath();
          break;
        case 'heart':
          // Simplified heart
          graphics.circle(size/3, size/3, size/4);
          graphics.circle(2*size/3, size/3, size/4);
          graphics.moveTo(size/2, size - 4);
          graphics.lineTo(2, size/3);
          graphics.lineTo(size - 2, size/3);
          graphics.closePath();
          break;
        case 'square':
          graphics.rect(2, 2, size - 4, size - 4);
          break;
      }
      
      graphics.fill({ color: 0xFFFFFF }); // White - tint will colorize
      
      // Generate texture from graphics
      const texture = renderer.generateTexture(graphics);
      this.textures.set(shape, texture);
      
      // Destroy the graphics (we only need the texture now)
      graphics.destroy();
      }
    }
  
  /**
   * Draw a 5-pointed star path
   */
  private drawStar(g: PIXI.Graphics, cx: number, cy: number, radius: number): void {
    const spikes = 5;
    const innerRadius = radius * 0.5;
    let rotation = -Math.PI / 2;
    
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? radius : innerRadius;
      const angle = rotation + (i * Math.PI) / spikes;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      
      if (i === 0) {
        g.moveTo(x, y);
      } else {
        g.lineTo(x, y);
      }
    }
    g.closePath();
  }
  
  /**
   * UPDATE METHOD: Sync game particles to Pixi particles each frame
   * Rebuilds particleChildren array to match current game state
   */
  public update(): void {
    // Physics update
    this.particleSystem.update();
    
    const gameParticles = this.particleSystem.getParticles();
    const pixiParticles = this.container.particleChildren;
    
    // Resize Pixi particle array to match game particles
    // Remove excess
    while (pixiParticles.length > gameParticles.length) {
      pixiParticles.pop();
    }
    
    // Update existing + add new
    for (let i = 0; i < gameParticles.length; i++) {
      const gp = gameParticles[i];
      const texture = this.textures.get(gp.shape) || this.textures.get('circle')!;
      const scale = gp.scale * 0.5;
      const alpha = gp.alpha * (gp.life / gp.startLife);
      
      if (i < pixiParticles.length) {
        // Update existing particle (cast to Particle for tint/alpha setters)
        const pp = pixiParticles[i] as PIXI.Particle;
        pp.texture = texture;
        pp.x = gp.x;
        pp.y = gp.y;
        pp.rotation = gp.rotation;
        pp.scaleX = scale;
        pp.scaleY = scale;
        pp.tint = gp.color;
        pp.alpha = alpha;
      } else {
        // Create new particle
        const pp = new PIXI.Particle({
          texture,
          x: gp.x,
          y: gp.y,
          rotation: gp.rotation,
          scaleX: scale,
          scaleY: scale,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: gp.color,
          alpha
        });
        pixiParticles.push(pp);
      }
    }
    
    // Mark container as needing update (required after modifying particleChildren)
    this.container.update();
  }
  
  /**
   * Get the container to add to stage
   */
  public getContainer(): PIXI.Container {
    return this.container;
  }
  
  /**
   * Clean up resources (only called when leaving raid)
   */
  public destroy(): void {
    // Remove from ticker
    if (this.app && this.tickerFn) {
      this.app.ticker.remove(this.tickerFn);
      this.tickerFn = null;
      this.app = null;
    }
    
    // Clear particles (ParticleContainer handles cleanup)
    this.container.particleChildren.length = 0;
    
    // Destroy shared textures
    for (const texture of this.textures.values()) {
      texture.destroy(true);
    }
    this.textures.clear();
    
    // Destroy container
    if (this.container && !this.container.destroyed) {
      this.container.destroy();
    }
  }
}
