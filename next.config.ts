import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@huggingface/transformers', '@mastra/core'],
};

export default config;
