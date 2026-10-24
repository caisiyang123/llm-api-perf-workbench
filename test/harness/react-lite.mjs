/**
 * A tiny React-compatible renderer used only by tests.
 *
 * It is intentionally not a general implementation: it supports the exact hook
 * set and element shapes this workbench's panel uses, renders the panel with a
 * mocked `service`/`fetch`, and lets a test walk the resulting element tree.
 * This catches render-time crashes, bad hook order, missing strings and broken
 * number formatting without needing a browser or Electron.
 */

export const Fragment = Symbol('Fragment');

class Instance {
  constructor(component, props) {
    this.component = component;
    this.props = props;
    this.hooks = [];
    this.effects = [];
    this.cursor = 0;
    this.dirty = false;
  }

  render() {
    this.cursor = 0;
    this.pendingEffects = [];
    current = this;
    try {
      return this.component(this.props);
    } finally {
      current = null;
    }
  }

  flushEffects() {
    for (let index = 0; index < this.pendingEffects.length; index += 1) {
      const { fn, deps } = this.pendingEffects[index];
      const previous = this.effects[index];
      const changed = !previous || deps == null || !sameDeps(previous.deps, deps);
      if (!changed) continue;
      if (previous && typeof previous.cleanup === 'function') previous.cleanup();
      const cleanup = fn();
      this.effects[index] = { deps, cleanup };
    }
  }
}

function sameDeps(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

let current = null;

function hookSlot(kind, init) {
  const instance = current;
  const index = instance.cursor++;
  if (!instance.hooks[index]) instance.hooks[index] = { kind, value: init };
  return instance.hooks[index];
}

function useState(initial) {
  const slot = hookSlot('state', typeof initial === 'function' ? initial() : initial);
  const instance = current;
  const setter = (updater) => {
    slot.value = typeof updater === 'function' ? updater(slot.value) : updater;
    instance.dirty = true;
  };
  return [slot.value, setter];
}

function useRef(initial) {
  const slot = hookSlot('ref', { current: initial });
  return slot.value;
}

function useCallback(fn, deps) {
  const slot = hookSlot('callback', { fn, deps });
  if (slot.value.deps == null || !sameDeps(slot.value.deps, deps)) slot.value = { fn, deps };
  return slot.value.fn;
}

function useEffect(fn, deps) {
  const instance = current;
  instance.pendingEffects.push({ fn, deps });
}

function createElement(type, props, ...children) {
  const flat = [];
  const push = (child) => {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) {
      child.forEach(push);
      return;
    }
    flat.push(child);
  };
  children.forEach(push);
  return { type, props: props || {}, children: flat };
}

export const ReactLite = {
  createElement,
  Fragment,
  useState,
  useRef,
  useCallback,
  useEffect,
};

export function createRequire() {
  return (id) => {
    if (id === 'react') return ReactLite;
    throw new Error(`Unexpected require(${id}) in client bundle`);
  };
}

function flushMicrotasks(rounds = 6) {
  return new Promise((resolve) => {
    let left = rounds;
    const step = () => {
      left -= 1;
      if (left <= 0) {
        resolve();
        return;
      }
      setImmediate(step);
    };
    setImmediate(step);
  });
}

/** Render a component until no state update is pending (bounded). */
export async function render(component, props, { maxRenders = 12 } = {}) {
  const instance = new Instance(component, props);
  let tree = null;
  for (let round = 0; round < maxRenders; round += 1) {
    tree = instance.render();
    instance.flushEffects();
    await flushMicrotasks();
    if (!instance.dirty) break;
    instance.dirty = false;
  }
  return { tree, instance };
}

export async function rerender(instance) {
  let tree = null;
  for (let round = 0; round < 12; round += 1) {
    tree = instance.render();
    instance.flushEffects();
    await flushMicrotasks();
    if (!instance.dirty) break;
    instance.dirty = false;
  }
  return tree;
}

/** Flatten an element tree into readable text. */
export function textOf(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree.children.map(textOf).join(' ');
}

/** Depth-first search over nodes whose type matches. */
export function findAll(tree, predicate) {
  const hits = [];
  const walk = (node) => {
    if (node == null || typeof node !== 'object') return;
    if (predicate && predicate(node)) hits.push(node);
    (node.children || []).forEach(walk);
  };
  walk(tree);
  return hits;
}

/** Find a clickable node whose flattened text equals/contains `label`. */
export function findButton(tree, label) {
  return findAll(tree, (node) => typeof node.type === 'string' && (node.type === 'button' || node.type === 'a')).find((node) =>
    textOf(node).includes(label),
  );
}

export async function click(instance, label) {
  const tree = instance.render();
  const button = findButton(tree, label);
  if (!button) throw new Error(`button not found: ${label}`);
  if (!button.props.onClick) throw new Error(`button has no onClick: ${label}`);
  button.props.onClick();
  return rerender(instance);
}

export function installGlobals() {
  const originals = {
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    localStorage: globalThis.localStorage,
    document: globalThis.document,
  };
  const intervals = [];
  globalThis.setInterval = (fn) => {
    intervals.push(fn);
    return intervals.length;
  };
  globalThis.clearInterval = () => {};
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const styleTags = [];
  globalThis.document = {
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (tag) => styleTags.push(tag) },
  };
  return {
    styleTags,
    intervals,
    restore() {
      globalThis.fetch = originals.fetch;
      globalThis.setInterval = originals.setInterval;
      globalThis.clearInterval = originals.clearInterval;
      globalThis.setTimeout = originals.setTimeout;
      globalThis.clearTimeout = originals.clearTimeout;
      globalThis.localStorage = originals.localStorage;
      globalThis.document = originals.document;
    },
  };
}