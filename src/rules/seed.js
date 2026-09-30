/**
 * 全新建档时的初始数据，直接是 v2 结构（带归属版本与完整标记）。
 * 旧版 JSON 的补版由 migration.js 负责。
 */
export function buildSeed() {
  return {
    version: 2,
    pigeons: [
      {
        ringNo: "CHN-2026-001",
        owner: "北岸棚",
        firstOwner: "育种棚",
        fatherRing: "CHN-2022-188",
        motherRing: "CHN-2023-512",
        color: "灰",
        loft: "北岸A棚",
        lineageComplete: false,
        ownerVersion: 2,
        vaccines: [{ date: "2026-04-01", name: "新城疫" }],
        transfers: [{ version: 2, date: "2026-04-15", from: "育种棚", to: "北岸棚" }],
        races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }]
      },
      {
        ringNo: "CHN-2022-188",
        owner: "育种棚",
        firstOwner: "育种棚",
        fatherRing: "",
        motherRing: "",
        color: "雨点",
        loft: "种鸽棚",
        lineageComplete: false,
        ownerVersion: 1,
        vaccines: [],
        transfers: [],
        races: []
      },
      {
        ringNo: "CHN-2023-512",
        owner: "育种棚",
        firstOwner: "育种棚",
        fatherRing: "",
        motherRing: "",
        color: "红轮",
        loft: "种鸽棚",
        lineageComplete: false,
        ownerVersion: 1,
        vaccines: [],
        transfers: [],
        races: []
      }
    ],
    batches: [],
    reviews: []
  };
}
