# Persontest 2 Rig

This folder was exported from Persontest Rig.

## Files

- `character.svg`: the SVG artwork.
- `animation.json`: rig data, joints, bones, timeline, fps and keyframes.
- `rig-runtime.js`: lightweight browser runtime.
- `RigEmbed.tsx`: React component ready to paste into Magic Pattern or another React app.
- `MagicPattern-Paste.txt`: open this file, copy the code inside, and paste it into Magic Pattern.
- `index.html`: standalone example.

## Usage

Open `index.html` directly or through a local web server for a standalone preview.

## Magic Pattern / React

Use `RigEmbed.tsx` when you want to drop the animation into a React-based project like Magic Pattern.

If Magic Pattern does not let you upload `.tsx` files, open `MagicPattern-Paste.txt`, copy the component code inside, and paste it directly.

```tsx
import RigEmbed from './RigEmbed';

export default function Example() {
  return <RigEmbed className="w-full max-w-[760px]" autoplay loop />;
}
```

To mount the exported animation inside your own site, copy the files into your project and use:

```html
<div id="character-animation"></div>
<script src="./rig-runtime.js"></script>
<script>
  RigPlayer.mount('#character-animation', {
    svg: './character.svg',
    animation: './animation.json',
    autoplay: true,
    loop: true
  });
</script>
```
