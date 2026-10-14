import React, { useEffect, useRef, useState } from "react";

// The mascot is built from geometry: no remote model, texture, or tracking service.
export default function Character({ wave, onWave }) {
  const host = useRef(),
    gesture = useRef(null),
    [ready, setReady] = useState(false),
    [fallback, setFallback] = useState(false);
  useEffect(() => {
    gesture.current?.();
  }, [wave]);
  useEffect(() => {
    let cancelled = false,
      dispose = () => {};
    (async () => {
      let renderer;
      try {
        const [T, { RoundedBoxGeometry }] = await Promise.all([
          import("three"),
          import("three/addons/geometries/RoundedBoxGeometry.js"),
        ]);
        if (cancelled) return;
        const el = host.current,
          scene = new T.Scene(),
          camera = new T.PerspectiveCamera(33, 1, 0.1, 40);
        camera.position.set(4.2, 3.1, 7.2);
        camera.lookAt(0, 1.22, 0);
        renderer = new T.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
        renderer.setClearColor(0, 0);
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.3;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;
        el.appendChild(renderer.domElement);
        scene.add(new T.HemisphereLight(0xffffff, 0xbbb8b0, 3));
        const key = new T.DirectionalLight(0xffffff, 5);
        key.position.set(-3, 6, 6);
        key.castShadow = true;
        key.shadow.mapSize.set(512, 512);
        key.shadow.camera.left = -4;
        key.shadow.camera.right = 4;
        key.shadow.camera.top = 5;
        key.shadow.camera.bottom = -4;
        key.shadow.normalBias = 0.025;
        key.shadow.radius = 4;
        scene.add(key);
        const rim = new T.DirectionalLight(0xf9e6dd, 2);
        rim.position.set(4, 2, -3);
        scene.add(rim);
        const white = new T.MeshStandardMaterial({
          color: 0xf4f2ed,
          roughness: 0.32,
          metalness: 0.08,
        });
        const red = new T.MeshStandardMaterial({
          color: 0xd5373f,
          roughness: 0.34,
          metalness: 0.15,
        });
        const ink = new T.MeshStandardMaterial({
          color: 0x222b2c,
          roughness: 0.25,
          metalness: 0.15,
        });
        const grey = new T.MeshStandardMaterial({
          color: 0xb5bab2,
          roughness: 0.5,
        });
        const led = new T.MeshBasicMaterial({ color: 0xeef8dc });
        const model = new T.Group();
        scene.add(model);
        model.rotation.y = -0.16;
        function rounded(w, h, d, r, material, parent, x = 0, y = 0, z = 0) {
          const mesh = new T.Mesh(
            new RoundedBoxGeometry(w, h, d, 5, r),
            material,
          );
          mesh.position.set(x, y, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
          return mesh;
        }
        const body = rounded(1.23, 0.85, 0.84, 0.22, white, model, 0, 0.79, 0);
        rounded(0.6, 0.31, 0.06, 0.055, red, model, 0, 0.83, 0.44);
        const digits = ["1010111", "1010101", "1110111", "0010101", "0010111"];
        digits.forEach((row, y) =>
          [...row].forEach((v, x) => {
            if (v === "1")
              rounded(
                0.033,
                0.033,
                0.014,
                0.007,
                led,
                model,
                (x - 3) * 0.052,
                0.93 - y * 0.049,
                0.479,
              );
          }),
        );
        for (const x of [-0.36, 0.36])
          rounded(0.49, 0.29, 0.73, 0.13, grey, model, x, 0.16, 0.16);
        const head = new T.Group();
        head.position.y = 1.88;
        model.add(head);
        rounded(1.8, 1.32, 1.13, 0.29, white, head);
        rounded(1.42, 0.87, 0.12, 0.19, ink, head, 0, 0.015, 0.567);
        const eyes = [];
        for (const x of [-0.32, 0.32])
          eyes.push(
            rounded(0.13, 0.32, 0.045, 0.06, led, head, x, 0.075, 0.647),
          );
        rounded(0.13, 0.035, 0.04, 0.016, red, head, 0, -0.2, 0.647);
        for (const x of [-0.96, 0.96])
          rounded(0.2, 0.56, 0.65, 0.1, red, head, x, 0.02, 0);
        const band = new T.Mesh(
          new T.TorusGeometry(0.94, 0.07, 10, 40, Math.PI),
          red,
        );
        band.position.y = 0.02;
        band.position.z = -0.1;
        head.add(band);
        rounded(0.055, 0.33, 0.055, 0.02, grey, head, 0, 0.83, -0.07);
        const light = new T.Mesh(new T.SphereGeometry(0.13, 20, 16), red);
        light.position.set(0, 1.04, -0.07);
        head.add(light);
        const arms = [];
        for (const side of [-1, 1]) {
          const arm = new T.Group();
          arm.position.set(side * 0.78, 1.02, 0);
          model.add(arm);
          rounded(0.3, 0.66, 0.34, 0.14, white, arm, 0, -0.27, 0);
          arm.rotation.z = side * 0.18;
          arms.push(arm);
        }
        const floor = new T.Mesh(
          new T.PlaneGeometry(20, 20),
          new T.ShadowMaterial({ opacity: 0.075 }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.005;
        floor.receiveShadow = true;
        scene.add(floor);
        const reduce = matchMedia("(prefers-reduced-motion: reduce)"),
          target = { x: 0, y: 0 };
        let activeUntil = performance.now() + 900,
          blinkUntil = 0;
        const gl = renderer.getContext(),
          debug = gl.getExtension("WEBGL_debug_renderer_info"),
          software =
            debug &&
            /swiftshader|llvmpipe|software/i.test(
              gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
            );
        const interval = software ? 1000 / 8 : 1000 / 24;
        let raf = 0,
          last = 0,
          visible = true,
          waving = 0,
          started = performance.now();
        const draw = () => renderer.render(scene, camera);
        const resize = () => {
          const { width, height } = el.getBoundingClientRect();
          if (!width || !height) return;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          draw();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();
        const move = (e) => {
          if (reduce.matches) return;
          const rect = el.getBoundingClientRect();
          target.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          target.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
          activeUntil = performance.now() + 650;
          schedule();
        };
        const leave = () => {
          target.x = target.y = 0;
          activeUntil = performance.now() + 700;
          schedule();
        };
        const interaction = el.parentElement;
        interaction.addEventListener("pointermove", move);
        interaction.addEventListener("pointerleave", leave);
        gesture.current = () => {
          if (reduce.matches) {
            draw();
            return;
          }
          waving = performance.now();
          activeUntil = waving + 1700;
          schedule();
        };
        function tick(now) {
          raf = 0;
          if (!visible || document.hidden || reduce.matches) return;
          if (now - last < interval) {
            schedule();
            return;
          }
          last = now;
          const t = (now - started) / 1000;
          head.rotation.y += (target.x * 0.3 - head.rotation.y) * 0.07;
          head.rotation.x += (target.y * 0.12 - head.rotation.x) * 0.07;
          model.position.y = now - waving < 1700 ? Math.sin(t * 4) * 0.035 : 0;
          const blink = now < blinkUntil ? 0.12 : 1;
          eyes.forEach((eye) => (eye.scale.y = blink));
          const elapsed = (now - waving) / 1000;
          arms[1].rotation.z =
            waving && elapsed < 1.5
              ? 1.95 + Math.sin(elapsed * 18) * 0.25
              : 0.18;
          model.rotation.z =
            waving && elapsed < 1.5
              ? Math.sin(elapsed * 7) * 0.035
              : Math.sin(t * 1.5) * 0.015;
          draw();
          if (now < activeUntil) schedule();
        }
        function schedule() {
          if (!raf && !reduce.matches && visible && !document.hidden)
            raf = requestAnimationFrame(tick);
        }
        const io = new IntersectionObserver(
          (entries) => {
            visible = entries[0].isIntersecting;
            if (visible) schedule();
            else {
              cancelAnimationFrame(raf);
              raf = 0;
            }
          },
          { threshold: 0.05 },
        );
        io.observe(el);
        const changed = () => {
          cancelAnimationFrame(raf);
          raf = 0;
          if (reduce.matches) {
            head.rotation.set(0, 0, 0);
            model.position.y = 0;
            model.rotation.z = 0;
            draw();
          } else schedule();
        };
        reduce.addEventListener("change", changed);
        document.addEventListener("visibilitychange", changed);
        const contextLost = (e) => {
          e.preventDefault();
          cancelAnimationFrame(raf);
          raf = 0;
          setFallback(true);
        };
        renderer.domElement.addEventListener("webglcontextlost", contextLost);
        const blinkTimer = setInterval(() => {
          if (visible && !document.hidden && !reduce.matches) {
            blinkUntil = performance.now() + 150;
            activeUntil = blinkUntil + 200;
            schedule();
          }
        }, 4500);
        draw();
        schedule();
        setReady(true);
        dispose = () => {
          clearInterval(blinkTimer);
          cancelAnimationFrame(raf);
          ro.disconnect();
          io.disconnect();
          gesture.current = null;
          interaction.removeEventListener("pointermove", move);
          interaction.removeEventListener("pointerleave", leave);
          reduce.removeEventListener("change", changed);
          document.removeEventListener("visibilitychange", changed);
          renderer.domElement.removeEventListener(
            "webglcontextlost",
            contextLost,
          );
          const geometries = new Set(),
            materials = new Set();
          scene.traverse((o) => {
            if (o.geometry) geometries.add(o.geometry);
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material])
              if (m) materials.add(m);
          });
          geometries.forEach((g) => g.dispose());
          materials.forEach((m) => m.dispose());
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        renderer?.dispose();
        if (!cancelled) setFallback(true);
      }
    })();
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);
  return (
    <div
      className={"character-stage " + (ready && !fallback ? "is-ready" : "")}
    >
      <div className="character-canvas" ref={host} aria-hidden="true" />
      {(!ready || fallback) && (
        <div className="character-fallback" aria-hidden="true">
          <i />
          <div>
            <span />
            <span />
          </div>
          <b>48</b>
          <em />
          <em />
        </div>
      )}
      <button
        className="character-hit"
        onClick={onWave}
        aria-label="Sapa karakter Pip, maskot JKT48Connect"
      />
      <span className="character-caption">PIP / YOUR LITTLE CONNECTION</span>
    </div>
  );
}
