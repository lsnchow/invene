/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow connections to backend
  async rewrites() {
    return [
      {
        source: '/api/relay/:path*',
        destination: 'http://localhost:8811/api/relay/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
