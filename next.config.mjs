const nextConfig = {
  experimental: {
    // ppr: true, // Disabled again, as 15.1.0 stable might still have specific requirements
    clientSegmentCache: true,
    // nodeMiddleware: true // Removed, not a recognized option in Next.js 15.1.0
  }
};

export default nextConfig; 