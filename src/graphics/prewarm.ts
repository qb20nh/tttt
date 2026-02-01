import { useEffect } from 'react';
import { getRenderer } from './renderer';
import {
    createGameCamera,
    createGameTexture,
    createGameMaterial,
    createGameScene,
    createGameMesh
} from './setup';

// Prewarm Shaders using requestIdleCallback to avoid blocking the main thread
export const useShaderPrewarm = () => {
    useEffect(() => {
        if (typeof window === 'undefined' || !window.requestIdleCallback) return;

        const handle = window.requestIdleCallback((deadline) => {
            // Safety check for idle time
            if (deadline.timeRemaining() < 10) return;

            try {
                // 1. Get Singleton Renderer
                const renderer = getRenderer();

                // 2. Setup Resources using Shared Factories
                const scene = createGameScene();
                const camera = createGameCamera();
                const texture = createGameTexture();
                // Max depth (4) and defaults for compilation
                const material = createGameMaterial(texture, 4, 0);
                const { mesh, geometry } = createGameMesh(material);

                scene.add(mesh);

                // 3. Async Compile (Non-blocking)
                // Use KHR_parallel_shader_compile if available to compile off-main-thread.
                if (renderer.compileAsync) {
                    renderer.compileAsync(scene, camera).then(() => {
                        // Once compiled, perform a quick render to set pipeline state (blending etc)
                        // This should be very fast now that shaders are ready.
                        renderer.render(scene, camera);

                        // 4. Cleanup
                        texture.dispose();
                        material.dispose();
                        geometry.dispose();
                    });
                } else {
                    // Fallback for older browsers (though Three 0.182+ has it)
                    renderer.compile(scene, camera);
                    renderer.render(scene, camera);

                    texture.dispose();
                    material.dispose();
                    geometry.dispose();
                }

            } catch (e) {
                console.warn("Shader prewarm failed:", e);
            }
        }, { timeout: 2000 }); // Try to run within 2s

        return () => window.cancelIdleCallback(handle);
    }, []);
};
