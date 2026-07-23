// サイトごとの設定を集約する
// monthsAhead: 何ヶ月先まで対象にするか（土日祝を対象）
// minVacantMinutes: 通知対象とする連続空き時間のしきい値（分）。共通ルールは3時間=180分

export const sites = [
  {
    id: "okegawa",
    name: "桶川サンアリーナ",
    adapter: "okegawa",
    monthsAhead: 3,
    minVacantMinutes: 180,
    baseUrl: "https://okegawa-sunarena.or.jp/okesun/akijyou/index2.php",
    courtLabels: ["バドミ０１", "バドミ０２", "バドミ０３", "バドミ０４"]
  },
  {
    id: "hasuda",
    name: "蓮田市公共施設予約・案内システム",
    adapter: "hasuda",
    monthsAhead: 3,
    minVacantMinutes: 180,
    entryUrl: "https://www.task-asp.net/cu/eg/ykr112381.task",
    facilities: [
      {
        code: "0006",
        name: "総合市民体育館パルシー",
        rooms: [
          { code: "00009:124", name: "メインアリーナ全面" },
          { code: "00009:112", name: "メインアリーナ１／２面Ａ" },
          { code: "00009:1324", name: "メインアリーナ１／２面Ｂ" },
          { code: "00010:108", name: "サブアリーナ全面" },
          { code: "00010:104", name: "サブアリーナ１／２面Ａ" },
          { code: "00010:508", name: "サブアリーナ１／２面Ｂ" }
        ]
      },
      {
        code: "0002",
        name: "農業者トレーニングセンター",
        rooms: [
          { code: "00001:101", name: "多目的ホール（片面Ａ・ステージあり）" },
          { code: "00002:101", name: "多目的ホール（片面Ｂ）" }
        ]
      }
    ]
  },
  {
    id: "ageo",
    name: "上尾市公共施設予約システム",
    adapter: "ageo",
    monthsAhead: 2,
    minVacantMinutes: 180,
    homeUrl: "https://www.pf-yoyaku.com/User/ageo/Home",
    facilityCategory: "市民体育館",
    facilityName: "自動車精工　上尾市民体育館（市民体育館）",
    rooms: ["アリーナ"]
  }
];
