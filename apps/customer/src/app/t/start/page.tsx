import {CustomerOrder} from "../[qr]/customer-order";
export const dynamic = "force-dynamic";
export default function StartPage(){
  return <CustomerOrder qr="start"/>;
}
