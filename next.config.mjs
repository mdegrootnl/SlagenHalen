const nextConfig = {
  experimental: {
    // ppr: true, // Disabled as it requires canary for Next.js 14.2.0
    clientSegmentCache: true,
    nodeMiddleware: true
  }
};

export default nextConfig; 