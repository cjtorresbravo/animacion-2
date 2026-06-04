'use strict';

(function () {
  const DEFAULT_TRANSFORM = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };

  async function mount(target, options) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) {
      throw new Error('RigPlayer target not found.');
    }

    const [svgMarkup, animationPayload] = await Promise.all([
      resolveSvgMarkup(options),
      resolveAnimationPayload(options)
    ]);
    const project = animationPayload.project || animationPayload;
    const hiddenPartIds = new Set(animationPayload.hiddenPartIds || []);
    const runtime = createRuntime(host, normalizeSvgMarkup(svgMarkup), project, hiddenPartIds);

    if (options.autoplay !== false) {
      runtime.play({ loop: options.loop !== false });
    } else {
      runtime.seek(1);
    }

    return runtime;
  }

  async function resolveSvgMarkup(options) {
    if (typeof options.svgMarkup === 'string' && options.svgMarkup.trim()) {
      return options.svgMarkup;
    }

    if (!options.svg) {
      throw new Error('RigPlayer requires either "svg" or "svgMarkup".');
    }

    return fetchText(options.svg);
  }

  async function resolveAnimationPayload(options) {
    if (options.animationData && typeof options.animationData === 'object') {
      return options.animationData;
    }

    if (!options.animation) {
      throw new Error('RigPlayer requires either "animation" or "animationData".');
    }

    return fetchJson(options.animation);
  }

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Could not load ' + url);
    }
    return response.text();
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Could not load ' + url);
    }
    return response.json();
  }

  function createRuntime(host, svgMarkup, project, hiddenPartIds) {
    host.innerHTML = svgMarkup;
    const svg = host.querySelector('svg');
    if (!svg) {
      throw new Error('Exported SVG does not contain an <svg> root.');
    }

    svg.setAttribute('viewBox', project.viewBox || svg.getAttribute('viewBox') || '0 0 300 300');
    svg.style.overflow = 'visible';

    Array.from(svg.querySelectorAll('[id]')).forEach((element) => {
      element.dataset.baseTransform = element.getAttribute('transform') || '';
    });

    const visualIdToPartId = buildVisualIdToPartId(project.parts || []);
    let rafId = null;
    let startedAt = 0;
    let currentFrame = 1;
    let shouldLoop = true;

    function seek(frame) {
      currentFrame = clampFrame(Math.round(frame), project.totalFrames || 1);
      applyFrame(svg, project, currentFrame, hiddenPartIds, visualIdToPartId);
    }

    function play(options) {
      shouldLoop = options?.loop !== false;
      stop();
      startedAt = performance.now() - ((currentFrame - 1) / (project.fps || 24)) * 1000;

      const tick = (now) => {
        const elapsedFrames = Math.floor(((now - startedAt) / 1000) * (project.fps || 24));
        const totalFrames = project.totalFrames || 1;
        let nextFrame = 1 + elapsedFrames;

        if (nextFrame > totalFrames) {
          if (!shouldLoop) {
            seek(totalFrames);
            stop();
            return;
          }
          nextFrame = ((nextFrame - 1) % totalFrames) + 1;
        }

        seek(nextFrame);
        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    seek(1);
    return { play, stop, seek, getFrame: () => currentFrame, svg };
  }

  function applyFrame(svg, sourceProject, frame, hiddenPartIds, visualIdToPartId) {
    const project = cloneProject(sourceProject);
    project.parts = (project.parts || []).map((part) => ({
      ...part,
      transform: getInterpolatedTransform(sourceProject, part.id, frame)
    }));
    const geometry = computeGeometry(project.parts || [], { inheritSharedChain: true });
    const hiddenSet = buildEffectiveHiddenSet(project.parts || [], Array.from(hiddenPartIds));

    Array.from(svg.querySelectorAll('[id]')).forEach((element) => {
      const visualId = element.getAttribute('id') || '';
      const id = visualIdToPartId.get(visualId) || visualId;
      const baseTransform = element.dataset.baseTransform || '';
      const part = (project.parts || []).find((item) => item.id === id);

      element.style.display = hiddenSet.has(id) ? 'none' : '';
      element.style.opacity = '';
      element.style.filter = '';

      if (!part || hiddenSet.has(id)) {
        return;
      }

      const partGeometry = geometry.get(id);
      if (!partGeometry) {
        return;
      }

      const transform = matrixToTransform(partGeometry.worldMatrix);
      element.setAttribute('transform', baseTransform ? baseTransform + ' ' + transform : transform);
    });
  }

  function normalizeSvgMarkup(markup) {
    return String(markup).replace(/<\?xml[\s\S]*?\?>/i, '').trim();
  }

  function buildVisualIdToPartId(parts) {
    const map = new Map();
    parts.forEach((part) => {
      const visualIds = Array.isArray(part.visualIds) && part.visualIds.length > 0
        ? part.visualIds
        : [String(part.selector || '').replace(/^#/, ''), part.id];
      visualIds.forEach((visualId) => {
        if (visualId) map.set(visualId, part.id);
      });
    });
    return map;
  }

  function buildEffectiveHiddenSet(parts, hiddenPartIds) {
    const directHidden = new Set(hiddenPartIds);
    const effectiveHidden = new Set(directHidden);
    const byId = new Map(parts.map((part) => [part.id, part]));

    parts.forEach((part) => {
      let cursor = part;
      while (cursor) {
        if (directHidden.has(cursor.id)) {
          effectiveHidden.add(part.id);
          break;
        }
        cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
      }
    });

    return effectiveHidden;
  }

  function getInterpolatedTransform(project, partId, frame) {
    const track = (project.tracks || []).find((item) => item.partId === partId);
    const part = (project.parts || []).find((item) => item.id === partId);
    const base = part?.transform || DEFAULT_TRANSFORM;

    if (!track || !track.keyframes || track.keyframes.length === 0) {
      return { ...base };
    }

    const keyframes = [...track.keyframes].sort((left, right) => left.frame - right.frame);
    const exact = keyframes.find((keyframe) => keyframe.frame === frame);
    if (exact) {
      return { ...exact.transform };
    }

    const previous = [...keyframes].reverse().find((keyframe) => keyframe.frame < frame);
    const next = keyframes.find((keyframe) => keyframe.frame > frame);

    if (!previous && next) return { ...next.transform };
    if (previous && !next) return { ...previous.transform };
    if (!previous || !next) return { ...base };

    const span = Math.max(next.frame - previous.frame, 1);
    const rawProgress = (frame - previous.frame) / span;
    const progress = applyEasing(rawProgress, previous.easing || 'linear');

    return {
      rotation: lerp(previous.transform.rotation, next.transform.rotation, progress),
      x: lerp(previous.transform.x, next.transform.x, progress),
      y: lerp(previous.transform.y, next.transform.y, progress),
      scaleX: lerp(previous.transform.scaleX, next.transform.scaleX, progress),
      scaleY: lerp(previous.transform.scaleY, next.transform.scaleY, progress),
    };
  }

  function applyEasing(progress, easing) {
    if (easing === 'ease-in') return progress * progress;
    if (easing === 'ease-out') return 1 - Math.pow(1 - progress, 2);
    if (easing === 'ease-in-out') {
      return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    }
    return progress;
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function computeGeometry(parts, options) {
    const byId = new Map(parts.map((part) => [part.id, part]));
    const children = new Map();
    const geometry = new Map();

    parts.forEach((part) => {
      if (!part.parentId || !byId.has(part.parentId)) return;
      const siblings = children.get(part.parentId) || [];
      siblings.push(part.id);
      children.set(part.parentId, siblings);
    });

    const applyRecursive = (partId, parentMatrix) => {
      const part = byId.get(partId);
      if (!part) return;

      const localMatrix = composePartMatrix(part);
      const worldMatrix = multiplyMatrices(parentMatrix, localMatrix);
      const pivot = part.bone ? transformPoint(worldMatrix, part.bone.pivot.x, part.bone.pivot.y) : { x: 0, y: 0 };
      const tip = part.bone ? transformPoint(worldMatrix, part.bone.tip.x, part.bone.tip.y) : pivot;

      geometry.set(part.id, { parentWorldMatrix: parentMatrix, worldMatrix, worldPivot: pivot, worldTip: tip });

      (children.get(part.id) || []).forEach((childId) => {
        const child = byId.get(childId);
        const childParent = child && shouldShareAnchor(part, child) && !options?.inheritSharedChain ? parentMatrix : worldMatrix;
        applyRecursive(childId, childParent);
      });
    };

    parts
      .filter((part) => !part.parentId || !byId.has(part.parentId))
      .forEach((part) => applyRecursive(part.id, identityMatrix()));

    return geometry;
  }

  function shouldShareAnchor(parentPart, childPart) {
    return Boolean(
      parentPart.bone?.startJointId &&
        parentPart.bone?.endJointId &&
        childPart.bone?.startJointId &&
        childPart.bone?.endJointId
    );
  }

  function composePartMatrix(part) {
    const state = part.transform || DEFAULT_TRANSFORM;
    const bone = part.bone;
    if (!bone) return identityMatrix();

    const x = bone.pivot.x;
    const y = bone.pivot.y;
    let matrix = identityMatrix();
    matrix = multiplyMatrices(matrix, translateMatrix(bone.restTranslateX || 0, bone.restTranslateY || 0));
    matrix = multiplyMatrices(matrix, translateMatrix(x, y));
    matrix = multiplyMatrices(matrix, rotateMatrix(bone.restRotate || 0));
    matrix = multiplyMatrices(matrix, translateMatrix(-x, -y));
    matrix = multiplyMatrices(matrix, translateMatrix(state.x, state.y));
    matrix = multiplyMatrices(matrix, translateMatrix(x, y));
    matrix = multiplyMatrices(matrix, rotateMatrix(state.rotation));
    matrix = multiplyMatrices(matrix, scaleMatrix(state.scaleX, state.scaleY));
    matrix = multiplyMatrices(matrix, translateMatrix(-x, -y));
    return matrix;
  }

  function identityMatrix() {
    return [1, 0, 0, 1, 0, 0];
  }

  function translateMatrix(tx, ty) {
    return [1, 0, 0, 1, tx, ty];
  }

  function scaleMatrix(sx, sy) {
    return [sx, 0, 0, sy, 0, 0];
  }

  function rotateMatrix(degrees) {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [cos, sin, -sin, cos, 0, 0];
  }

  function multiplyMatrices(left, right) {
    return [
      left[0] * right[0] + left[2] * right[1],
      left[1] * right[0] + left[3] * right[1],
      left[0] * right[2] + left[2] * right[3],
      left[1] * right[2] + left[3] * right[3],
      left[0] * right[4] + left[2] * right[5] + left[4],
      left[1] * right[4] + left[3] * right[5] + left[5],
    ];
  }

  function matrixToTransform(matrix) {
    const [a, b, c, d, e, f] = matrix;
    return 'matrix(' + [
      a.toFixed(6),
      b.toFixed(6),
      c.toFixed(6),
      d.toFixed(6),
      e.toFixed(2),
      f.toFixed(2)
    ].join(' ') + ')';
  }

  function transformPoint(matrix, x, y) {
    return {
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5],
    };
  }

  function clampFrame(frame, totalFrames) {
    return Math.max(1, Math.min(totalFrames || 1, frame));
  }

  function cloneProject(project) {
    return JSON.parse(JSON.stringify(project));
  }

  window.RigPlayer = { mount };
})();
