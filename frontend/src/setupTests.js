// jest-dom adds custom matchers for asserting on DOM nodes.
import '@testing-library/jest-dom';

import { TextDecoder, TextEncoder } from 'util';

// jsdom ships without these, and the streaming reader needs TextDecoder.
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
