# OS Notes

## Distribution

I choose the latest Ubuntu LTS (desktop version). It's not my favorite distro, but it has proven
out-of-the-box compatibility with almost everything

## Post install

### Install docker

```sh
tbd
```

### Remove snap

```sh
# list all snap packages
sudo snap list

# remove one by one, for example:
sudo snap remove --purge thunderbird

# the last one to remove:
sudo snap remove --purge snapd

# remove snapd
sudo systemctl stop snapd
sudo apt remove --purge snapd
sudo rm -rf /var/cache/snapd/

# block reinstall
sudo apt-mark hold snapd
```
