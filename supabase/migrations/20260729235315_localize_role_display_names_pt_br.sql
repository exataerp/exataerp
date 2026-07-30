update public.roles
set display_name = case name
  when 'maintenance_manager' then 'Gestor de Manutenção'
  when 'maintenance_user' then 'Usuário de Manutenção'
  when 'production_manager' then 'Gestor de Produção'
  when 'production_user' then 'Usuário de Produção'
  when 'quality_manager' then 'Gestor da Qualidade'
  when 'stock_manager' then 'Gestor de Estoque'
  when 'stock_user' then 'Usuário de Estoque'
  when 'system_manager' then 'Administrador do Sistema'
  when 'viewer' then 'Visualizador'
  else display_name
end
where name in (
  'maintenance_manager',
  'maintenance_user',
  'production_manager',
  'production_user',
  'quality_manager',
  'stock_manager',
  'stock_user',
  'system_manager',
  'viewer'
);
