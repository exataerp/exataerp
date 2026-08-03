# E-mail de convite do Supabase

O convite enviado por `inviteUserByEmail` usa o template **Invite user** do Supabase Auth.

- **Assunto:** `Seu convite para acessar a Exata`
- **Corpo:** [`supabase/templates/invite.html`](../supabase/templates/invite.html)
- **Template do painel:** Authentication > Emails > Templates > Invite user

O HTML precisa manter a variável `{{ .ConfirmationURL }}`, pois ela contém o link seguro usado para aceitar o convite e iniciar o primeiro acesso.

Em projetos hospedados, alterações no arquivo local não atualizam o painel automaticamente. Ao revisar o texto, replique o assunto e o corpo no template **Invite user** do projeto de produção.
