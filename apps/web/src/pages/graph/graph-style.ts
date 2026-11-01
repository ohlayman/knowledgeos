export interface GraphPalette {
  canvas: string;
  node: string;
  selected: string;
  link: string;
  conflict: string;
  text: string;
}

export type NodeGeometry = 'sphere' | 'box' | 'tetra' | 'octa' | 'prism';

const PALETTES: Record<'light' | 'dark', GraphPalette> = {
  light: {
    canvas: '#fbfaf7',
    node: '#8c8779',
    selected: '#2c5a5f',
    link: '#9a9284',
    conflict: '#9e2b25',
    text: '#3a3833',
  },
  dark: {
    canvas: '#121110',
    node: '#a49d8f',
    selected: '#6fa8a6',
    link: '#6e675a',
    conflict: '#e07a70',
    text: '#c4beb2',
  },
};

export function graphPalette(resolved: 'light' | 'dark'): GraphPalette {
  return PALETTES[resolved];
}

export function geometryFor(type: string): NodeGeometry {
  switch (type) {
    case 'technology':
      return 'box';
    case 'project':
      return 'prism';
    case 'agent':
      return 'octa';
    case 'protocol':
      return 'tetra';
    default:
      return 'sphere';
  }
}
