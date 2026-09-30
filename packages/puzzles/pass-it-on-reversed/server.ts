import { createPassItOn } from '../pass-it-on/server';

/** Reverse Charges: Pass It On with every clip played backwards instead of shuffled. */
export default createPassItOn({
  id: 'pass-it-on-reversed',
  name: 'Reverse Charges',
  description:
    'Pass It On, but every clip plays backwards. Clips only go one way round your team: the ' +
    'Builder has the parts, the Reader the steps in glyphs, the Keyholder what the glyphs mean.',
  transform: { kind: 'reverse' },
});
