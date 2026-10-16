-- PolicyAid CRM: 20 clearly fake demo leads (mobile numbers 9800000101 to 9800000120) for trying the system.
-- Optional. They are unassigned, so use Leads > Reassign to hand them to callers and see the queue work.
-- Safe to run twice. Delete them before go-live (Leads > filter "DEMO" > select all > Delete, as admin).

insert into public.leads (
  state, reg_no, rto_code, reg_date, name, guardian_name, address, engine_no, chassis_no,
  vehicle_make, vehicle_model, vehicle_class, fuel, sale_amount, seat_capacity, phone, city, source
)
select
  (array['MAHARASHTRA','DELHI','KARNATAKA','GUJARAT','UTTAR PRADESH'])[1 + n % 5],
  (array['MH12','DL01','KA03','GJ01','UP16'])[1 + n % 5] || 'FAKE' || lpad(n::text, 4, '0'),
  (array['MH12','DL01','KA03','GJ01','UP16'])[1 + n % 5],
  date '2026-09-01' + (n % 28),
  'DEMO OWNER ' || upper((array['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN',
    'ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN','TWENTY'])[n]),
  'DEMO GUARDIAN ' || n,
  n || ' Example Street (fake address)',
  'FAKEENG' || lpad(n::text, 5, '0'),
  'FAKECHS' || lpad(n::text, 5, '0'),
  (array['MARUTI SUZUKI','HYUNDAI','TATA MOTORS','HONDA','MAHINDRA','BAJAJ','TOYOTA','TVS'])[1 + n % 8],
  (array['SWIFT VXI','CRETA SX','NEXON XZ+','ACTIVA 6G','XUV700 AX7','PULSAR 150','INNOVA CRYSTA','JUPITER'])[1 + n % 8],
  case when n % 2 = 0 then 'MOTOR CAR' else 'M-CYCLE/SCOOTER' end,
  case when n % 3 = 0 then 'DIESEL' else 'PETROL' end,
  60000 + n * 25000,
  case when n % 2 = 0 then 5 else 2 end,
  '98000001' || lpad(n::text, 2, '0'),
  (array['Pune','New Delhi','Bengaluru','Ahmedabad','Noida'])[1 + n % 5],
  'demo'
from generate_series(1, 20) as n
on conflict (reg_no) do nothing;

select count(*) as demo_leads from public.leads where source = 'demo';
