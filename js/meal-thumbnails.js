/* 餐食缩略图使用项目内的照片，避免为每条记录请求在线生成图片。 */
function mealThumbnail(name) {
  if (/奶|豆浆|饮料|咖啡|果汁/.test(name)) return "image/drink.jpg";
  if (/饺|馄饨/.test(name)) return "image/dumplings.jpg";
  if (/面|粉/.test(name)) return "image/noodles.jpg";
  if (/肉|鸡|饭|牛|排|羊/.test(name)) return "image/chicken-meal.jpg";
  if (/果|瓜|莓|橙|柚|桃|葡萄/.test(name)) return "image/kiwi-bg.jpg";
  return "image/veggies.jpg";
}
