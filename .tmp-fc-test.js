const fc = require('fast-check');

// Verify fc.string with unit + fc.char works in v4
const nameChar = fc.char().filter(c => c !== '/');
const nameArb = fc.string({ unit: nameChar, minLength: 1, maxLength: 6 });
console.log('name samples:', fc.sample(nameArb, 5));

// Verify fc.uniqueArray with selector
const uniqueSibs = fc.uniqueArray(
  fc.record({ name: nameArb, val: fc.integer() }),
  { maxLength: 4, selector: (x) => x.name }
);
const us = fc.sample(uniqueSibs, 3);
console.log('unique siblings sample:', JSON.stringify(us[0]));
console.log('unique siblings sample 1:', JSON.stringify(us[1]));

// Verify fc.letrec with tie
const { treeNode } = fc.letrec(tie => ({
  treeNode: fc.record({
    name: nameArb,
    children: fc.oneof(
      { depthSize: 'xsmall', withCrossShrink: true },
      fc.constant([]),
      fc.uniqueArray(tie('treeNode'), { maxLength: 3, selector: (x) => x.name })
    ),
  }),
}));
const forestArb = fc.uniqueArray(treeNode, { maxLength: 3, selector: (x) => x.name });
const forest = fc.sample(forestArb, 1)[0];
console.log('forest[0]:', JSON.stringify(forest, null, 2).slice(0, 1000));

// Verify fc.constantFrom(null)
const cf = fc.constantFrom(null);
console.log('constantFrom(null) sample:', fc.sample(cf, 3));
