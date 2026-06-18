import { CUBISM_SHADER_BASE_URL } from "./cubism-assets";
import { createCubismExpressionController } from "./cubism-expression";
import { CubismLookController } from "./cubism-look";
import { WITCH_MODEL3_URL, type LoadedLive2DModel, type Model3Json } from "./types";

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }

  return await response.arrayBuffer();
}

function resolveModelAssetUrl(relativePath: string): string {
  return `pet-model://witch/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function parseModel3(buffer: ArrayBuffer): Model3Json {
  const text = new TextDecoder().decode(buffer);
  return JSON.parse(text) as Model3Json;
}

function assertFileReference(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing model3 file reference: ${label}`);
  }

  return value;
}

async function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to fetch texture ${url}: ${response.status}`);
  }

  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: "premultiply"
  });

  const texture = gl.createTexture();

  if (!texture) {
    bitmap.close();
    throw new Error("failed to create Live2D texture");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  bitmap.close();

  return texture;
}

export async function loadWitchLive2DModel(
  gl: WebGL2RenderingContext,
  width: number,
  height: number
): Promise<LoadedLive2DModel> {
  const [{ CubismUserModel }, { CubismModelSettingJson }] = await Promise.all([
    import("./vendor/framework/model/cubismusermodel"),
    import("./vendor/framework/cubismmodelsettingjson")
  ]);
  const expressionController = await createCubismExpressionController();
  let lookController: CubismLookController | null = null;

  class PetCubismUserModel extends CubismUserModel {
    public updateFrame(deltaSeconds: number): void {
      const model = this.getModel();
      model.loadParameters();

      if (this._physics) {
        this._physics.evaluate(model, deltaSeconds);
      }

      model.saveParameters();
      expressionController.update(model, deltaSeconds);
      lookController?.update(model, deltaSeconds);
      model.update();
    }

    public hasPhysics(): boolean {
      return Boolean(this._physics);
    }
  }

  const model3Buffer = await fetchArrayBuffer(WITCH_MODEL3_URL);
  const model3 = parseModel3(model3Buffer);
  const setting = new CubismModelSettingJson(model3Buffer, model3Buffer.byteLength);
  const mocPath = assertFileReference(model3.FileReferences?.Moc, "Moc");
  const texturePaths = model3.FileReferences?.Textures;

  if (!Array.isArray(texturePaths) || texturePaths.length === 0) {
    throw new Error("missing model3 file reference: Textures");
  }

  const userModel = new PetCubismUserModel();
  const mocBuffer = await fetchArrayBuffer(resolveModelAssetUrl(mocPath));
  userModel.loadModel(mocBuffer);

  if (!userModel.getModel()) {
    throw new Error("failed to load Live2D moc3");
  }

  lookController = new CubismLookController(userModel.getModel());

  const physicsPath = model3.FileReferences?.Physics;

  if (physicsPath) {
    const physicsBuffer = await fetchArrayBuffer(resolveModelAssetUrl(physicsPath));
    userModel.loadPhysics(physicsBuffer, physicsBuffer.byteLength);
  }

  userModel.createRenderer(width, height);

  const renderer = userModel.getRenderer();
  renderer.startUp(gl);
  renderer.loadShaders(CUBISM_SHADER_BASE_URL);
  renderer.setIsPremultipliedAlpha(true);

  await Promise.all(texturePaths.map(async (texturePath, textureIndex) => {
    const texture = await loadTexture(gl, resolveModelAssetUrl(texturePath));
    renderer.bindTexture(textureIndex, texture);
  }));

  setting.release();

  return {
    userModel,
    update(deltaSeconds: number): void {
      userModel.updateFrame(deltaSeconds);
    },
    setExpression(emotion): Promise<void> {
      return expressionController.setExpression(emotion);
    },
    clearExpression(): void {
      expressionController.clearExpression();
    },
    getAvailableExpressions(): string[] {
      return expressionController.getAvailableExpressions();
    },
    setLookTarget(x: number, y: number): void {
      lookController?.setTarget(x, y);
    },
    setLookPaused(paused: boolean): void {
      lookController?.setPaused(paused);
    },
    release(): void {
      expressionController.release();
      userModel.release();
    }
  };
}
