/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 123云盘风格 (保留旧令牌名以兼容)
        "apple-blue": "#1677FF",
        "apple-blue-hover": "#4096FF",
        "apple-gray": "#646A73",
        "apple-light": "#F5F6F7",
        "apple-dark": "#1F2329",
        // 新品牌令牌
        "brand-blue": "#1677FF",
        "brand-blue-hover": "#4096FF",
        "brand-blue-light": "#E8F3FF",
        "brand-blue-active": "#0958D9",
        "brand-red": "#F53F3F",
        "brand-red-hover": "#F76560",
        "brand-green": "#00B578",
        "brand-orange": "#FF8F1F",
        // 中性色
        "bg-primary": "#F5F6F7",
        "bg-secondary": "#FAFBFC",
        "bg-white": "#FFFFFF",
        "text-primary": "#1F2329",
        "text-secondary": "#646A73",
        "text-tertiary": "#8F959E",
        "text-disabled": "#BCC0C6",
        "border-light": "#E5E6EB",
        "border-default": "#DCDEE0",
      },
    },
  },
  plugins: [],
};
