// Slide type registry entry point. Each type file registers itself on import;
// add one import line per type, alphabetical (content types live in types/content/).
import './types/advanced/grid_2x2';
import './types/advanced/guess_number';
import './types/advanced/hundred_points';
import './types/advanced/pin_on_image';
import './types/content/big_number';
import './types/content/bullets';
import './types/content/heading';
import './types/content/image';
import './types/content/instructions';
import './types/content/paragraph';
import './types/content/quote';
import './types/content/video';
import './types/leaderboard';
import './types/open_ended';
import './types/ranking';
import './types/scales';
import './types/select_answer';
import './types/type_answer';
import './types/wordcloud';

export * from './registry';
export * from './types';
export * from './ops';
export * from './fields';
export * from './replay';
