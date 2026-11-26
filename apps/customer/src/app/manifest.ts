import type {MetadataRoute} from "next";
export default function manifest():MetadataRoute.Manifest {
  return {
    name:"قائمة الطعام | مطعمك",
    short_name:"مطعمك",
    start_url:"/",
    scope:"/",
    display:"standalone",
    background_color:"#FFFFFF",
    theme_color:"#FF6B4A",
    lang:"ar",
    dir:"rtl",
    icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"maskable"}],
  };
}
