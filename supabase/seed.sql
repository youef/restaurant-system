-- Local development seed only. Do not run against production without reviewing the sample menu.
insert into public.settings (id, restaurant_name_ar, restaurant_name_en, vat_rate)
values (1, 'مطعم تجريبي', 'Demo Restaurant', 0.15)
on conflict (id) do nothing;

insert into public.categories (id, name_ar, name_en, sort_order)
values
  ('10000000-0000-4000-8000-000000000001','المقبلات','Starters',1),
  ('10000000-0000-4000-8000-000000000002','الأطباق الرئيسية','Main courses',2),
  ('10000000-0000-4000-8000-000000000003','المشروبات','Drinks',3)
on conflict (id) do nothing;

insert into public.products (id,category_id,name_ar,name_en,description_ar,price,station,is_featured,sort_order)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','حمص','Hummus','حمص بالطحينة وزيت الزيتون',18,'kitchen',true,1),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','سلطة خضراء','Green salad','خضروات موسمية طازجة',22,'kitchen',false,2),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','دجاج مشوي','Grilled chicken','دجاج مشوي مع الأرز',48,'grill',true,1),
  ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','برجر لحم','Beef burger','برجر لحم مع البطاطس',42,'grill',false,2),
  ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','ليمون بالنعناع','Mint lemonade','ليمون طازج ونعناع',16,'bar',true,1)
on conflict (id) do nothing;

insert into public.restaurant_tables (number, seats)
select g, 4 from generate_series(1,8) g
on conflict (number) do nothing;
