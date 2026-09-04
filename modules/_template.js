module.exports = {
  init: async (ctx) => {
    // Optional initialization hook
  },
  fns: {
    // Functions are merged into ctx.fns
    example_fn: async ([arg]) => {
      return arg;
    }
  }
};
