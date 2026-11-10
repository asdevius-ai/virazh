// КОНТРАКТ ДАНИХ «Вираж». Єдине джерело правди для tools/ і src/.
// Опис файлів і прикладів — docs/DATA.md. Міняти тільки за рішенням ліда.

/** [довгота, широта], WGS84, 6 знаків після коми. */
export type LngLat = [number, number];

export interface LineString {
  type: 'LineString';
  coordinates: LngLat[];
}

/** Тип об'єкта на маршруті. Ключ у pdr-signs.json. */
export type PoiType =
  | 'crossing' // пішохідний перехід (highway=crossing)
  | 'traffic_signals' // світлофор (highway=traffic_signals, crossing=traffic_signals)
  | 'give_way' // «Дати дорогу» (highway=give_way)
  | 'stop' // «Проїзд без зупинки заборонено» (highway=stop)
  | 'roundabout' // в'їзд на коло (junction=roundabout)
  | 'level_crossing' // залізничний переїзд (railway=level_crossing)
  | 'speed_bump' // штучна нерівність (traffic_calming=*)
  | 'bus_stop' // зупинка громадського транспорту (highway=bus_stop)
  | 'sign'; // інший знак із traffic_sign=* (код у pdrCode)

/** Запис довідника public/data/pdr-signs.json (масив PdrSign). */
export interface PdrSign {
  type: PoiType;
  /** Номер знака за ПДР України, напр. "5.38.1". null — якщо знака як такого немає (світлофор). */
  pdrCode: string | null;
  /** Назва українською, напр. "Пішохідний перехід". */
  label: string;
  /** Ім'я іконки (без розширення) у src/assets/signs/, напр. "crossing". */
  icon: string;
}

/** Об'єкт на маршруті, спроєктований на лінію. Масив відсортований за distanceAlongM. */
export interface RoutePoi {
  /** Унікальний у межах маршруту, напр. "6841_1-p12". */
  id: string;
  routeId: string;
  type: PoiType;
  pdrCode?: string;
  label: string;
  /** Точка НА лінії маршруту (після проєкції). */
  coord: LngLat;
  /** Відстань від старту маршруту, метри (ціле). */
  distanceAlongM: number;
}

/** Відрізок маршруту, що йде однією вулицею. Відрізки покривають [0, lengthM] без дірок. */
export interface StreetSegment {
  /** Назва вулиці українською; "" якщо безіменний проїзд. */
  name: string;
  fromM: number;
  toM: number;
}

/** Короткий опис маршруту у файлі ТСЦ. */
export interface RouteMeta {
  /** "<centerId>_<n>", напр. "6841_3". */
  id: string;
  /** Порядковий номер маршруту в ТСЦ (1..N). */
  number: number;
  /** "Маршрут №3". */
  name: string;
  /** Категорії з офіційної схеми, напр. "B, C1, D1, D, BE, C1E, D1E, DE". */
  category: string;
  lengthM: number;
  verified: boolean;
}

/** public/data/centers/<id>.json */
export interface Center {
  id: string;
  /** "ТСЦ МВС № 6841". */
  name: string;
  city: string;
  address: string;
  /** Координати ТСЦ. */
  coord: LngLat;
  routes: RouteMeta[];
}

/** Елемент public/data/centers.json (масив CenterSummary). */
export interface CenterSummary {
  id: string;
  name: string;
  city: string;
  address: string;
  routeCount: number;
}

/** public/data/routes/<id>.json — повний маршрут з усім потрібним для програвання. */
export interface Route extends RouteMeta {
  centerId: string;
  /** Спрощена лінія в порядку руху; перша точка — старт. */
  geometry: LineString;
  /** Ім'я файлу офіційної схеми, напр. "6841_3.jpg". */
  sourceImage: string;
  /** Пояснення, якщо маршрут — чернетка. */
  notes?: string;
  pois: RoutePoi[];
  streets: StreetSegment[];
}
