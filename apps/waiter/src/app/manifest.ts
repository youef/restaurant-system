import type {MetadataRoute} from "next";
export default function manifest():MetadataRoute.Manifest {
  return {
    name:"مهام النادل",
    short_name:"النادل",
    start_url:"/waiter",
    scope:"/",
    display:"standalone",
    background_color:"#F3F5F9",
    theme_color:"#1B2A41",
    lang:"ar",
    dir:"rtl",
    icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any maskable"}],
  };
}
